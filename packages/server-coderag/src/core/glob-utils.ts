import micromatch from 'micromatch';
import path from 'node:path';
import { statSync, readdirSync, readFileSync, existsSync } from 'node:fs';

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

function loadGitignorePatterns(dir: string): string[] {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) return [];
  try {
    return readFileSync(gitignorePath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!'))
      .map((p) => (p.startsWith('/') ? p.slice(1) : `**/${p}`));
  } catch {
    return [];
  }
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

function isDirExcluded(dirPath: string, absExcludes: string[]): boolean {
  const normalized = dirPath.replace(/\\/g, '/');
  if (micromatch.isMatch(normalized, absExcludes, { dot: true })) return true;
  if (micromatch.isMatch(normalized + '/x', absExcludes, { dot: true })) return true;
  return false;
}

export class GlobMatcher {
  private readonly absIncludes: string[];
  private readonly absExcludes: string[];
  private readonly cwd: string;
  private readonly useGitignore: boolean;

  constructor(
    includePatterns: string[],
    excludePatterns: string[],
    cwd: string,
    useGitignore = false,
  ) {
    this.cwd = cwd.replace(/\\/g, '/');
    this.useGitignore = useGitignore;
    this.absIncludes = includePatterns.map((p) => resolveToAbsolute(p, cwd));
    this.absExcludes = [
      ...WELL_KNOWN_EXCLUDES.map((p) => resolveToAbsolute(p, cwd)),
      ...excludePatterns.map((p) => resolveToAbsolute(p, cwd)),
    ];
  }

  isIncluded(filePath: string): boolean {
    const abs = path.resolve(filePath).replace(/\\/g, '/');
    return (
      micromatch.isMatch(abs, this.absIncludes) &&
      !micromatch.isMatch(abs, this.absExcludes, { dot: true })
    );
  }

  isExcluded(filePath: string): boolean {
    const abs = path.resolve(filePath).replace(/\\/g, '/');
    return micromatch.isMatch(abs, this.absExcludes, { dot: true });
  }

  findFiles(): string[] {
    const roots = new Set(this.absIncludes.map(extractGlobBase));
    const result = new Set<string>();
    const gitignoreCache = new Map<string, string[]>();
    for (const root of roots) {
      this.walkDir(root, result, gitignoreCache);
    }
    return [...result].sort();
  }

  private walkDir(
    dir: string,
    result: Set<string>,
    gitignoreCache: Map<string, string[]>,
  ): void {
    if (!existsSync(dir)) return;
    if (isDirExcluded(dir, this.absExcludes)) return;

    const extraExcludes: string[] = [];
    if (this.useGitignore) {
      if (!gitignoreCache.has(dir)) {
        gitignoreCache.set(dir, loadGitignorePatterns(dir).map((p) => resolveToAbsolute(p, dir)));
      }
      extraExcludes.push(...(gitignoreCache.get(dir) ?? []));
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry).replace(/\\/g, '/');

      if (isDirExcluded(fullPath, [...this.absExcludes, ...extraExcludes])) continue;
      if (micromatch.isMatch(fullPath, [...this.absExcludes, ...extraExcludes], { dot: true })) continue;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.walkDir(fullPath, result, gitignoreCache);
      } else if (micromatch.isMatch(fullPath, this.absIncludes)) {
        result.add(fullPath);
      }
    }
  }

  get includePatterns(): string[] { return this.absIncludes; }
  get excludePatterns(): string[] { return this.absExcludes; }
}
