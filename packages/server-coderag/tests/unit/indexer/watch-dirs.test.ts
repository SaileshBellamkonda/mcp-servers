import { describe, it, expect } from 'vitest';
import { computeWatchDirs } from '../../../src/indexer/watcher.js';

const globs = (over: Partial<{ docsInclude: string[]; codeInclude: string[] }>) => ({
  docsInclude: ['**/*.{md,mdx}'], docsExclude: [], codeInclude: ['**/*.ts'], codeExclude: [], ...over,
});

describe('computeWatchDirs', () => {
  it('watches the working directory for relative patterns and each distinct glob base once', () => {
    expect(computeWatchDirs(globs({}), '/work')).toEqual(['/work']);
    expect(computeWatchDirs(globs({ docsInclude: ['/work/docs/**/*.md'], codeInclude: ['/work/src/**/*.ts', '/work/src/**/*.tsx', 'lib/**/*.py'] }), '/work'))
      .toEqual(['/work/docs', '/work/src', '/work/lib']);
  });

  it('keeps one directory per workspace folder for the per-folder absolute patterns', () => {
    expect(computeWatchDirs(globs({ docsInclude: ['/a/**/*.md', '/b/**/*.md'], codeInclude: ['/a/**/*.ts', '/b/**/*.ts'] }), '/a'))
      .toEqual(['/a', '/b']);
  });

  it('stops at the first glob segment', () => {
    expect(computeWatchDirs(globs({ docsInclude: ['/work/docs/**/*.md'], codeInclude: ['/work/pk*/src/**/*.ts'] }), '/work')).toEqual(['/work/docs', '/work']);
  });
});
