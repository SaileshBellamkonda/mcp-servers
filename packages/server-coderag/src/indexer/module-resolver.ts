import path from 'node:path';

/**
 * Maps an import as written in a source file (`./util.js`, `..mod`, `crate::a::b`, `com.foo.Bar`) to an indexed file, or
 * to the directory of a package for languages that import a directory (Go, Java wildcards, C#). Only files that are in
 * the index can be the answer: packages and the standard library resolve to nothing.
 */
const posix = path.posix;

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SKIPPED_STEMS = new Set(['index', '__init__', 'mod']);

function normalize(file: string): string {
  return file.replaceAll('\\', '/');
}

/** Number of leading path segments two directories share. */
function sharedSegments(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  let n = 0;
  while (n < left.length && n < right.length && left[n] === right[n]) n++;
  return n;
}

/** The names other files use to import this file: its file name without extension and its folder name. */
export function moduleStems(file: string): string[] {
  const normalized = normalize(file);
  const stem = posix.basename(normalized, posix.extname(normalized));
  const folder = posix.basename(posix.dirname(normalized));
  return [stem, folder].filter((s) => s !== '' && s !== '.');
}

/** True when a name is too generic to narrow down the imports that might refer to a file. */
export function isGenericStem(stem: string): boolean {
  return SKIPPED_STEMS.has(stem);
}

export class CodeFileIndex {
  /** normalized path -> path as stored */
  private readonly files = new Map<string, string>();
  private readonly byBasename = new Map<string, Set<string>>();
  /** normalized directory -> the directory as stored and the number of indexed files directly in it */
  private readonly directories = new Map<string, { stored: string; count: number }>();
  private readonly directoriesByName = new Map<string, Set<string>>();

  constructor(files: Iterable<string> = []) {
    for (const file of files) this.add(file);
  }

  get size(): number {
    return this.files.size;
  }

  add(file: string): void {
    const key = normalize(file);
    if (this.files.has(key)) return;
    this.files.set(key, file);
    const base = posix.basename(key);
    const set = this.byBasename.get(base) ?? new Set<string>();
    set.add(key);
    this.byBasename.set(base, set);
    const dir = posix.dirname(key);
    const known = this.directories.get(dir);
    if (known) known.count++;
    else this.directories.set(dir, { stored: file.slice(0, dir.length), count: 1 });
    const dirName = posix.basename(dir);
    const dirs = this.directoriesByName.get(dirName) ?? new Set<string>();
    dirs.add(dir);
    this.directoriesByName.set(dirName, dirs);
  }

  remove(file: string): void {
    const key = normalize(file);
    if (!this.files.delete(key)) return;
    this.byBasename.get(posix.basename(key))?.delete(key);
    const dir = posix.dirname(key);
    const known = this.directories.get(dir);
    if (known && known.count > 1) {
      known.count--;
    } else {
      this.directories.delete(dir);
      this.directoriesByName.get(posix.basename(dir))?.delete(dir);
    }
  }

  has(file: string): boolean {
    return this.files.has(normalize(file));
  }

  /** The indexed file (or package directory) an import in `sourceFile` refers to; null when it is not in the index. */
  resolveImport(lang: string, module: string, names: readonly string[], sourceFile: string): string | null {
    const source = normalize(sourceFile);
    const found = this.resolveNormalized(lang, module, names, source);
    if (found === null) return null;
    return this.files.get(found) ?? this.directories.get(found)?.stored ?? found;
  }

  private resolveNormalized(lang: string, module: string, names: readonly string[], source: string): string | null {
    switch (lang) {
      case 'typescript':
      case 'tsx':
      case 'javascript':
        return this.resolveScript(module, source);
      case 'python':
        return this.resolvePython(module, source);
      case 'go':
        return this.resolveGo(module, source);
      case 'rust':
        return this.resolveRust(module, source);
      case 'java':
        return this.resolveJava(module, names, source);
      case 'csharp':
        return this.resolveCsharp(module, source);
      default:
        return null;
    }
  }

  private firstExisting(candidates: string[]): string | null {
    return candidates.find((candidate) => this.files.has(candidate)) ?? null;
  }

  private resolveScript(module: string, source: string): string | null {
    if (!module.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(source), module));
    if (this.files.has(base) && posix.extname(base) !== '') return base;
    const stripped = base.replace(/\.(?:[cm]?js|jsx)$/, '');
    return this.firstExisting([
      ...TS_EXTENSIONS.map((ext) => stripped + ext),
      ...TS_EXTENSIONS.map((ext) => `${base}/index${ext}`),
    ]);
  }

  private resolvePython(module: string, source: string): string | null {
    const dots = /^\.*/.exec(module)?.[0].length ?? 0;
    const rest = module.slice(dots).replaceAll('.', '/');
    if (dots > 0) {
      let base = posix.dirname(source);
      for (let i = 1; i < dots; i++) base = posix.dirname(base);
      return this.firstExisting(rest === '' ? [`${base}/__init__.py`] : [`${base}/${rest}.py`, `${base}/${rest}/__init__.py`]);
    }
    if (rest === '') return null;
    // A file inside a package (its folder has an `__init__.py`) is imported as `package.module`, never as the bare
    // module: `import json` in flask/json/provider.py is the standard library, not flask/json/__init__.py.
    const candidates = [
      ...this.withSuffix(`${rest}.py`).filter((file) => !this.inPackage(file, `${rest}.py`)),
      ...this.withSuffix(`${rest}/__init__.py`).filter((file) => !this.inPackage(file, `${rest}/__init__.py`)),
    ];
    return this.closest(candidates, source);
  }

  /** True when the part of `file` before `suffix` is itself a Python package. */
  private inPackage(file: string, suffix: string): boolean {
    const root = file.slice(0, file.length - suffix.length).replace(/\/$/, '');
    return root !== '' && this.files.has(`${root}/__init__.py`);
  }

  private resolveGo(module: string, source: string): string | null {
    const segments = module.split('/');
    // Only module paths (`github.com/owner/repo/pkg`) can name a package of this repository.
    if (!(segments[0] ?? '').includes('.')) return null;
    const inRepo = segments.slice(3);
    if (inRepo.length === 0) return null;
    return this.closestDirectory(inRepo.join('/'), source);
  }

  private resolveRust(module: string, source: string): string | null {
    const segments = module.split('::').filter((s) => s !== '' && s !== 'crate' && s !== 'self' && s !== 'super');
    for (let length = segments.length; length > 0; length--) {
      const rel = segments.slice(0, length).join('/');
      const found = this.closest([...this.withSuffix(`${rel}.rs`), ...this.withSuffix(`${rel}/mod.rs`)], source);
      if (found !== null) return found;
    }
    return null;
  }

  private resolveJava(module: string, names: readonly string[], source: string): string | null {
    const segments = module.split('.');
    if (names.includes('*')) return this.closestDirectory(segments.join('/'), source);
    // `com.foo.Outer.Inner` imports a nested class: the file is the outer class.
    for (let length = segments.length; length >= Math.max(1, segments.length - 1); length--) {
      const found = this.closest(this.withSuffix(`${segments.slice(0, length).join('/')}.java`), source);
      if (found !== null) return found;
    }
    return null;
  }

  private resolveCsharp(module: string, source: string): string | null {
    const rel = module.split('.').join('/');
    return this.closestDirectory(rel, source) ?? this.closest(this.withSuffix(`${rel}.cs`), source);
  }

  /** Indexed files whose path ends with `/suffix` (or equals it). */
  private withSuffix(suffix: string): string[] {
    const base = posix.basename(suffix);
    const out: string[] = [];
    for (const candidate of this.byBasename.get(base) ?? []) {
      if (candidate === suffix || candidate.endsWith(`/${suffix}`)) out.push(candidate);
    }
    return out;
  }

  /** The candidate (file) sharing the most leading directories with the importing file; ties go to the shorter path. */
  private closest(candidates: string[], source: string): string | null {
    return this.nearest(candidates, (file) => posix.dirname(file), source);
  }

  /** An indexed directory whose path ends with `suffix`, nearest to the importing file. */
  private closestDirectory(suffix: string, source: string): string | null {
    const last = posix.basename(suffix);
    const matches = [...(this.directoriesByName.get(last) ?? [])].filter((dir) => dir === suffix || dir.endsWith(`/${suffix}`));
    return this.nearest(matches, (dir) => dir, source);
  }

  private nearest(candidates: string[], directoryOf: (candidate: string) => string, source: string): string | null {
    const dir = posix.dirname(source);
    const rank = (c: string): number => sharedSegments(directoryOf(c), dir);
    return [...candidates].sort((a, b) => rank(b) - rank(a) || a.length - b.length || a.localeCompare(b))[0] ?? null;
  }
}
