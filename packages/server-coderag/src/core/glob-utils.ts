import micromatch from 'micromatch';
import path from 'node:path';
import { statSync, readdirSync, readFileSync, existsSync, realpathSync, type Dirent } from 'node:fs';
import type { PathGuard } from './path-guard.ts';
import { createStderrLogger } from './logger.ts';

export const WELL_KNOWN_EXCLUDES = [
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.vs/**',
  '**/.eclipse/**',
  '**/.settings/**',
  '**/.project',
  '**/.classpath',
  '**/*.suo',
  '**/*.user',
  '**/*.userosscache',
  '**/*.sln.docstates',
  '**/.fleet/**',
  '**/.zed/**',
  '**/.nova/**',
  '**/.atom/**',
  '**/.sublime-project',
  '**/.sublime-workspace',
  '**/*.iml',
  '**/*.iws',
  '**/*.ipr',
  '**/__pycache__/**',
  '**/target/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/*.pyc',
  '**/*.pyo',
];

export const DEFAULT_DOCS_INCLUDE = ['**/*.{md,mdx}'];

export const DEFAULT_CODE_INCLUDE = [
  '**/*.{ts,tsx}',
  '**/*.{js,jsx}',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
  '**/*.java',
  '**/*.cs',
  '**/*.{cpp,cc,cxx,hpp}',
  '**/*.{c,h}',
  '**/*.rb',
  '**/*.php',
  '**/*.{sh,bash}',
  '**/*.vue',
];

/** A trailing slash only restricts a gitignore pattern to directories; it is dropped so the pattern names the directory itself. */
function loadGitignorePatterns(dir: string): string[] {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) return [];
  try {
    return readFileSync(gitignorePath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!'))
      .map((p) => p.replace(/\/+$/, ''))
      .filter((p) => p !== '')
      .map((p) => (p.startsWith('/') ? p.slice(1) : `**/${p}`));
  } catch {
    return [];
  }
}

type PathMatcher = (p: string) => boolean;

/** Compiles the patterns once, so matching a path does not parse every glob again. */
function compileMatcher(patterns: string[], options?: micromatch.Options): PathMatcher {
  const compiled = patterns.map((p) => micromatch.matcher(p, options));
  return (p) => compiled.some((m) => m(p));
}

export function resolveToAbsolute(pattern: string, cwd: string): string {
  if (path.isAbsolute(pattern)) return pattern.replace(/\\/g, '/');
  return path.join(cwd, pattern).replace(/\\/g, '/');
}

export function extractGlobBase(absPattern: string): string {
  const parts = absPattern.replace(/\\/g, '/').split('/');
  const firstGlobIdx = parts.findIndex((p) => /[*?{[!]/.test(p));
  if (firstGlobIdx === -1) return absPattern;
  const staticParts = parts.slice(0, firstGlobIdx);
  return staticParts.length === 0 ? '/' : staticParts.join('/');
}

function isDirExcluded(dirPath: string, isExcluded: PathMatcher): boolean {
  const normalized = dirPath.replace(/\\/g, '/');
  return isExcluded(normalized) || isExcluded(normalized + '/x');
}

/** Deepest directory nesting the walk descends into. */
export const DEFAULT_MAX_WALK_DEPTH = 100;
/** Most directory entries one findFiles() call inspects before it stops and warns. */
export const DEFAULT_MAX_WALK_ENTRIES = 500_000;

export interface GlobMatcherOptions {
  /** Also allows symlinked directories and files that resolve inside the guard's roots (not only inside the walked roots). */
  pathGuard?: PathGuard;
  maxDepth?: number;
  maxEntries?: number;
  /** Receives safety-cap warnings; defaults to a WARNING line on stderr. */
  warn?: (message: string) => void;
}

function realOrNull(p: string): string | null {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
}

function isUnder(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

interface WalkState {
  result: Set<string>;
  realRoots: string[];
  visited: Set<string>;
  entries: number;
  warned: boolean;
}

export class GlobMatcher {
  private readonly absIncludes: string[];
  private readonly absExcludes: string[];
  private readonly matchesInclude: PathMatcher;
  private readonly matchesExclude: PathMatcher;
  private readonly cwd: string;
  private readonly useGitignore: boolean;
  private readonly options: GlobMatcherOptions;

  constructor(
    includePatterns: string[],
    excludePatterns: string[],
    cwd: string,
    useGitignore = false,
    options: GlobMatcherOptions = {},
  ) {
    this.options = options;
    this.cwd = cwd.replace(/\\/g, '/');
    this.useGitignore = useGitignore;
    this.absIncludes = includePatterns.map((p) => resolveToAbsolute(p, cwd));
    this.absExcludes = [
      ...WELL_KNOWN_EXCLUDES.map((p) => resolveToAbsolute(p, cwd)),
      ...excludePatterns.map((p) => resolveToAbsolute(p, cwd)),
    ];
    this.matchesInclude = compileMatcher(this.absIncludes);
    this.matchesExclude = compileMatcher(this.absExcludes, { dot: true });
  }

  isIncluded(filePath: string): boolean {
    const abs = path.resolve(filePath).replace(/\\/g, '/');
    return this.matchesInclude(abs) && !this.matchesExclude(abs);
  }

  isExcluded(filePath: string): boolean {
    const abs = path.resolve(filePath).replace(/\\/g, '/');
    return this.matchesExclude(abs);
  }

  findFiles(): string[] {
    const roots = new Set(this.absIncludes.map(extractGlobBase));
    const state: WalkState = {
      result: new Set<string>(),
      realRoots: [],
      visited: new Set<string>(),
      entries: 0,
      warned: false,
    };
    for (const root of roots) {
      const real = realOrNull(root);
      if (real !== null) state.realRoots.push(real);
    }
    for (const root of roots) {
      this.walkDir(root, state, 0, this.matchesExclude);
    }
    return [...state.result].sort();
  }

  private warn(message: string): void {
    (this.options.warn ?? ((m: string) => { createStderrLogger().warning(m); }))(message);
  }

  private warnOnce(state: WalkState, message: string): void {
    if (state.warned) return;
    state.warned = true;
    this.warn(message);
  }

  /** A symlink target is only followed when it stays inside the walked roots or the guard's roots. */
  private isWithinBounds(state: WalkState, real: string): boolean {
    if (state.realRoots.some((root) => isUnder(root, real))) return true;
    return this.options.pathGuard?.isAllowed(real) ?? false;
  }

  /** `isExcluded` is the built-in excludes plus the .gitignore files of every directory above, so a .gitignore covers its whole subtree. */
  private walkDir(dir: string, state: WalkState, depth: number, isExcluded: PathMatcher): void {
    if (!existsSync(dir)) return;
    if (isDirExcluded(dir, isExcluded)) return;
    const maxDepth = this.options.maxDepth ?? DEFAULT_MAX_WALK_DEPTH;
    if (depth > maxDepth) {
      this.warnOnce(state, `Directory walk stopped below "${dir}": maximum depth of ${String(maxDepth)} exceeded. Deeper files are not indexed.`);
      return;
    }
    const realDir = realOrNull(dir);
    if (realDir === null || state.visited.has(realDir)) return;
    state.visited.add(realDir);

    let excluded = isExcluded;
    if (this.useGitignore) {
      const patterns = loadGitignorePatterns(dir).map((p) => resolveToAbsolute(p, dir));
      if (patterns.length > 0) {
        const inherited = isExcluded;
        const own = compileMatcher(patterns, { dot: true });
        excluded = (p) => inherited(p) || own(p);
      }
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_WALK_ENTRIES;
    for (const entry of entries) {
      state.entries++;
      if (state.entries > maxEntries) {
        this.warnOnce(state, `Directory walk stopped: more than ${String(maxEntries)} entries were inspected. Remaining files are not indexed.`);
        return;
      }
      const fullPath = path.join(dir, entry.name).replace(/\\/g, '/');

      if (isDirExcluded(fullPath, excluded)) continue;

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        const real = realOrNull(fullPath);
        if (real === null) continue;
        let target;
        try {
          target = statSync(real);
        } catch {
          continue;
        }
        isDirectory = target.isDirectory();
        isFile = target.isFile();
        if (!this.isWithinBounds(state, real)) {
          this.warn(`Skipping symlink "${fullPath}": it resolves outside the allowed roots.`);
          continue;
        }
        // A directory inside a walked root is reached by its own path; following the link again would
        // duplicate its files (or loop forever when the link points at an ancestor).
        if (isDirectory && state.realRoots.some((root) => isUnder(root, real))) continue;
      }

      if (isDirectory) {
        this.walkDir(fullPath, state, depth + 1, excluded);
      } else if (isFile && this.matchesInclude(fullPath)) {
        state.result.add(fullPath);
      }
    }
  }

  get includePatterns(): string[] { return this.absIncludes; }
  get excludePatterns(): string[] { return this.absExcludes; }
}
