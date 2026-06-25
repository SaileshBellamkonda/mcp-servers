import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import {
  GlobMatcher,
  WELL_KNOWN_EXCLUDES,
  DEFAULT_DOCS_INCLUDE,
  DEFAULT_CODE_INCLUDE,
} from '../../../src/core/glob-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-glob-test');

beforeEach(() => { mkdirSync(tmpDir, { recursive: true }); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('WELL_KNOWN_EXCLUDES', () => {
  it('contains .git pattern', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.git/**');
  });

  it('contains node_modules pattern', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/node_modules/**');
  });

  it('contains dist and build patterns', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/dist/**');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/build/**');
  });

  it('contains .vscode pattern', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.vscode/**');
  });

  it('contains .idea pattern (JetBrains)', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.idea/**');
  });

  it('contains .vs pattern (Visual Studio)', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.vs/**');
  });

  it('contains Visual Studio artefact patterns (.suo, .user)', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/*.suo');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/*.user');
  });

  it('contains .eclipse and .settings patterns', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.eclipse/**');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.settings/**');
  });

  it('contains Eclipse project file patterns', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.project');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.classpath');
  });

  it('contains JetBrains module file patterns (.iml, .iws, .ipr)', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/*.iml');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/*.iws');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/*.ipr');
  });

  it('contains Fleet, Zed, Nova, and Atom patterns', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.fleet/**');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.zed/**');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.nova/**');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.atom/**');
  });

  it('contains Sublime Text patterns', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.sublime-project');
    expect(WELL_KNOWN_EXCLUDES).toContain('**/.sublime-workspace');
  });

  it('contains coverage pattern', () => {
    expect(WELL_KNOWN_EXCLUDES).toContain('**/coverage/**');
  });
});

describe('DEFAULT_DOCS_INCLUDE', () => {
  it('contains a markdown pattern', () => {
    expect(DEFAULT_DOCS_INCLUDE.some((p) => p.includes('.md'))).toBe(true);
  });
});

describe('DEFAULT_CODE_INCLUDE', () => {
  it('contains TypeScript pattern', () => {
    expect(DEFAULT_CODE_INCLUDE.some((p) => /\bts\b/.test(p) || p.includes('.ts') || p.includes('{ts'))).toBe(true);
  });

  it('contains Python pattern', () => {
    expect(DEFAULT_CODE_INCLUDE.some((p) => p.includes('.py'))).toBe(true);
  });

  it('contains Go pattern', () => {
    expect(DEFAULT_CODE_INCLUDE.some((p) => p.includes('.go'))).toBe(true);
  });
});

describe('GlobMatcher.isIncluded', () => {
  it('returns true for a file matching the include pattern', () => {
    const matcher = new GlobMatcher(['**/*.md'], [], tmpDir);
    const file = path.join(tmpDir, 'doc.md').replace(/\\/g, '/');
    expect(matcher.isIncluded(file)).toBe(true);
  });

  it('returns false for a file not matching include pattern', () => {
    const matcher = new GlobMatcher(['**/*.md'], [], tmpDir);
    const file = path.join(tmpDir, 'code.ts').replace(/\\/g, '/');
    expect(matcher.isIncluded(file)).toBe(false);
  });

  it('returns false for a file inside node_modules', () => {
    const matcher = new GlobMatcher(['**/*.ts'], [], tmpDir);
    const file = path.join(tmpDir, 'node_modules', 'pkg.ts').replace(/\\/g, '/');
    expect(matcher.isIncluded(file)).toBe(false);
  });

  it('returns false for a file inside .git', () => {
    const matcher = new GlobMatcher(['**/*.ts'], [], tmpDir);
    const file = path.join(tmpDir, '.git', 'config.ts').replace(/\\/g, '/');
    expect(matcher.isIncluded(file)).toBe(false);
  });

  it('returns false when file matches an explicit exclude pattern', () => {
    const matcher = new GlobMatcher(['**/*.ts'], ['**/*.test.ts'], tmpDir);
    const included = path.join(tmpDir, 'app.ts').replace(/\\/g, '/');
    const excluded = path.join(tmpDir, 'app.test.ts').replace(/\\/g, '/');
    expect(matcher.isIncluded(included)).toBe(true);
    expect(matcher.isIncluded(excluded)).toBe(false);
  });

  it('returns false for file in dist/', () => {
    const matcher = new GlobMatcher(['**/*.js'], [], tmpDir);
    const file = path.join(tmpDir, 'dist', 'bundle.js').replace(/\\/g, '/');
    expect(matcher.isIncluded(file)).toBe(false);
  });
});

describe('GlobMatcher.isExcluded', () => {
  it('returns true for a file in node_modules', () => {
    const matcher = new GlobMatcher(['**/*.ts'], [], tmpDir);
    const file = path.join(tmpDir, 'node_modules', 'x.ts').replace(/\\/g, '/');
    expect(matcher.isExcluded(file)).toBe(true);
  });

  it('returns false for a normal source file', () => {
    const matcher = new GlobMatcher(['**/*.ts'], [], tmpDir);
    const file = path.join(tmpDir, 'src', 'app.ts').replace(/\\/g, '/');
    expect(matcher.isExcluded(file)).toBe(false);
  });

  it('returns true for a file matching an explicit exclude pattern', () => {
    const matcher = new GlobMatcher(['**/*.ts'], ['**/*.test.ts'], tmpDir);
    const file = path.join(tmpDir, 'app.test.ts').replace(/\\/g, '/');
    expect(matcher.isExcluded(file)).toBe(true);
  });

  it('returns true for file in .git', () => {
    const matcher = new GlobMatcher(['**/*'], [], tmpDir);
    const file = path.join(tmpDir, '.git', 'HEAD').replace(/\\/g, '/');
    expect(matcher.isExcluded(file)).toBe(true);
  });
});

describe('GlobMatcher.findFiles', () => {
  it('finds markdown files matching include pattern', () => {
    writeFileSync(path.join(tmpDir, 'a.md'), '# A');
    writeFileSync(path.join(tmpDir, 'b.md'), '# B');
    writeFileSync(path.join(tmpDir, 'c.ts'), 'const x = 1;');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.md`], [], tmpDir);
    const files = matcher.findFiles();
    expect(files.some((f) => f.endsWith('a.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('b.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('c.ts'))).toBe(false);
  });

  it('skips node_modules directory', () => {
    mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.ts'), 'module');
    writeFileSync(path.join(tmpDir, 'app.ts'), 'app');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir);
    const files = matcher.findFiles();
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.endsWith('app.ts'))).toBe(true);
  });

  it('skips .git directory', () => {
    mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    writeFileSync(path.join(tmpDir, '.git', 'config.ts'), 'git internal');
    writeFileSync(path.join(tmpDir, 'main.ts'), 'main');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir);
    const files = matcher.findFiles();
    expect(files.some((f) => f.includes('.git'))).toBe(false);
    expect(files.some((f) => f.endsWith('main.ts'))).toBe(true);
  });

  it('applies explicit exclude patterns', () => {
    writeFileSync(path.join(tmpDir, 'app.ts'), 'app');
    writeFileSync(path.join(tmpDir, 'app.test.ts'), 'test');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.ts`], ['**/*.test.ts'], tmpDir);
    const files = matcher.findFiles();
    expect(files.some((f) => f.endsWith('app.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('app.test.ts'))).toBe(false);
  });

  it('recursively finds files in subdirectories', () => {
    mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'src', 'utils', 'helper.ts'), 'helper');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir);
    const files = matcher.findFiles();
    expect(files.some((f) => f.includes('helper.ts'))).toBe(true);
  });

  it('returns sorted file list', () => {
    writeFileSync(path.join(tmpDir, 'z.md'), '# Z');
    writeFileSync(path.join(tmpDir, 'a.md'), '# A');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.md`], [], tmpDir);
    const files = matcher.findFiles();
    expect(files).toEqual([...files].sort());
  });

  it('returns empty array when include root does not exist', () => {
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/nonexistent/**/*.md`], [], tmpDir);
    expect(matcher.findFiles()).toEqual([]);
  });

  it('respects .gitignore when useGitignore is true', () => {
    writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored.ts\n');
    writeFileSync(path.join(tmpDir, 'visible.ts'), 'visible');
    writeFileSync(path.join(tmpDir, 'ignored.ts'), 'ignored');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir, true);
    const files = matcher.findFiles();
    expect(files.some((f) => f.endsWith('visible.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('ignored.ts'))).toBe(false);
  });

  it('ignores .gitignore when useGitignore is false', () => {
    writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored.ts\n');
    writeFileSync(path.join(tmpDir, 'visible.ts'), 'visible');
    writeFileSync(path.join(tmpDir, 'ignored.ts'), 'ignored');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir, false);
    const files = matcher.findFiles();
    expect(files.some((f) => f.endsWith('visible.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('ignored.ts'))).toBe(true);
  });

  it('skips dist directory', () => {
    mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'dist', 'bundle.js'), 'bundled');
    writeFileSync(path.join(tmpDir, 'src.js'), 'source');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const matcher = new GlobMatcher([`${tmpFwd}/**/*.js`], [], tmpDir);
    const files = matcher.findFiles();
    expect(files.some((f) => f.includes('dist'))).toBe(false);
    expect(files.some((f) => f.endsWith('src.js'))).toBe(true);
  });
});
