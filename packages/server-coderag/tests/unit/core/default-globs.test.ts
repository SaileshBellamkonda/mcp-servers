import { describe, it, expect } from 'vitest';
import { DEFAULT_DOCS_INCLUDE, GlobMatcher } from '../../../src/core/glob-utils.js';
import { loadConfigFromVsCode } from '../../../src/core/config.js';

describe('default docs include globs', () => {
  it('cover markdown and mdx', () => {
    expect(DEFAULT_DOCS_INCLUDE).toEqual(['**/*.{md,mdx}']);
  });

  it('match .md and .mdx files but not other files', () => {
    const matcher = new GlobMatcher(DEFAULT_DOCS_INCLUDE, [], '/proj');
    expect(matcher.isIncluded('/proj/a.md')).toBe(true);
    expect(matcher.isIncluded('/proj/docs/b.mdx')).toBe(true);
    expect(matcher.isIncluded('/proj/c.txt')).toBe(false);
  });

  it('are used for the VS Code workspace default', () => {
    const config = loadConfigFromVsCode(
      {
        get: (key: string): unknown => {
          if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
          if (key === 'embeddingModel') return 'nomic-embed-text';
          if (key === 'dbPath') return './coderag.db';
          return undefined;
        },
      },
      ['/ws'],
    );
    expect(config.globs.docsInclude).toEqual(['/ws/**/*.{md,mdx}']);
  });
});
