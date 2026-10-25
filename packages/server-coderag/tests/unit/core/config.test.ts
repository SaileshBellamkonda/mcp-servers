import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFromEnv, loadConfigFromVsCode } from '../../../src/core/config.js';
import { DEFAULT_DOCS_INCLUDE, DEFAULT_CODE_INCLUDE } from '../../../src/core/glob-utils.js';

describe('loadConfigFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when CODERAG_EMBEDDING_URL is missing', () => {
    delete process.env['CODERAG_EMBEDDING_URL'];
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    expect(() => loadConfigFromEnv()).toThrow('CODERAG_EMBEDDING_URL');
  });

  it('throws when CODERAG_EMBEDDING_MODEL is missing', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    delete process.env['CODERAG_EMBEDDING_MODEL'];
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    expect(() => loadConfigFromEnv()).toThrow('CODERAG_EMBEDDING_MODEL');
  });

  it('throws when CODERAG_DB_PATH is missing', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    delete process.env['CODERAG_DB_PATH'];
    expect(() => loadConfigFromEnv()).toThrow('CODERAG_DB_PATH');
  });

  it('returns config with required fields', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    const config = loadConfigFromEnv();
    expect(config.embedding.url).toBe('http://localhost:11434/v1');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.dbPath).toBe('/tmp/test.db');
  });

  it('applies default values for optional fields', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    delete process.env['CODERAG_DOCS_INCLUDE'];
    delete process.env['CODERAG_DOCS_EXCLUDE'];
    delete process.env['CODERAG_CODE_INCLUDE'];
    delete process.env['CODERAG_CODE_EXCLUDE'];
    delete process.env['CODERAG_CHUNK_SIZE'];
    delete process.env['CODERAG_TOP_K'];
    delete process.env['CODERAG_USE_GITIGNORE'];
    delete process.env['CODERAG_EMBEDDING_DIM'];
    const config = loadConfigFromEnv();
    expect(config.globs.docsInclude).toEqual(DEFAULT_DOCS_INCLUDE);
    expect(config.globs.docsExclude).toEqual([]);
    expect(config.globs.codeInclude).toEqual(DEFAULT_CODE_INCLUDE);
    expect(config.globs.codeExclude).toEqual([]);
    expect(config.chunkSize).toBe(500);
    expect(config.topK).toBe(5);
    expect(config.useGitignore).toBe(true);
    expect(config.embeddingDim).toBe(768);
  });

  it('parses CODERAG_EMBEDDING_DIM as integer', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    process.env['CODERAG_EMBEDDING_DIM'] = '768';
    const config = loadConfigFromEnv();
    expect(config.embeddingDim).toBe(768);
  });

  it('parses CODERAG_DOCS_EXCLUDE as semicolon-separated patterns', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    process.env['CODERAG_DOCS_EXCLUDE'] = '**/*.draft.md;drafts/**';
    const config = loadConfigFromEnv();
    expect(config.globs.docsExclude).toEqual(['**/*.draft.md', 'drafts/**']);
  });

  it('parses CODERAG_CODE_EXCLUDE as semicolon-separated patterns', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    process.env['CODERAG_CODE_EXCLUDE'] = '**/*.test.ts;dist/**';
    const config = loadConfigFromEnv();
    expect(config.globs.codeExclude).toEqual(['**/*.test.ts', 'dist/**']);
  });

  it('parses CODERAG_USE_GITIGNORE as boolean', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    process.env['CODERAG_USE_GITIGNORE'] = 'true';
    expect(loadConfigFromEnv().useGitignore).toBe(true);
    process.env['CODERAG_USE_GITIGNORE'] = '1';
    expect(loadConfigFromEnv().useGitignore).toBe(true);
    process.env['CODERAG_USE_GITIGNORE'] = 'yes';
    expect(loadConfigFromEnv().useGitignore).toBe(true);
    process.env['CODERAG_USE_GITIGNORE'] = 'false';
    expect(loadConfigFromEnv().useGitignore).toBe(false);
  });

  it('parses CODERAG_DOCS_INCLUDE as semicolon-separated patterns', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
    process.env['CODERAG_DOCS_INCLUDE'] = '/data/docs/**/*.md;/data/notes/**/*.md';
    const config = loadConfigFromEnv();
    expect(config.globs.docsInclude).toEqual(['/data/docs/**/*.md', '/data/notes/**/*.md']);
  });

  it('reads optional fields from environment', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'https://api.openai.com/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'text-embedding-3-small';
    process.env['CODERAG_EMBEDDING_API_KEY'] = 'sk-test';
    process.env['CODERAG_DB_PATH'] = '/data/mydb.db';
    process.env['CODERAG_DOCS_INCLUDE'] = '/data/docs/**/*.md';
    process.env['CODERAG_CHUNK_SIZE'] = '1000';
    process.env['CODERAG_TOP_K'] = '10';
    const config = loadConfigFromEnv();
    expect(config.embedding.apiKey).toBe('sk-test');
    expect(config.dbPath).toBe('/data/mydb.db');
    expect(config.globs.docsInclude).toEqual(['/data/docs/**/*.md']);
    expect(config.chunkSize).toBe(1000);
    expect(config.topK).toBe(10);
  });
});

describe('loadConfigFromVsCode', () => {
  it('reads required fields from VS Code configuration object', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        const vals: Record<string, unknown> = {
          embeddingUrl: 'http://localhost:11434/v1',
          embeddingModel: 'nomic-embed-text',
          embeddingApiKey: '',
          dbPath: './coderag.db',
          chunkSize: 500,
          topK: 5,
        };
        return vals[key];
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.embedding.url).toBe('http://localhost:11434/v1');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.dbPath).toBe('./coderag.db');
    expect(config.globs.docsExclude).toEqual([]);
    expect(config.useGitignore).toBe(true);
    expect(config.embeddingDim).toBe(768);
  });

  it('reads docsExclude array from VS Code configuration', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        if (key === 'docsExclude') return ['**/*.draft.md', 'drafts/**'];
        if (key === 'useGitignore') return true;
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.globs.docsExclude).toEqual(['**/*.draft.md', 'drafts/**']);
    expect(config.useGitignore).toBe(true);
  });

  it('reads docsExclude as semicolon-separated string from VS Code configuration', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        if (key === 'docsExclude') return '**/*.draft.md;drafts/**';
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.globs.docsExclude).toEqual(['**/*.draft.md', 'drafts/**']);
  });

  it('throws when embeddingUrl is missing from VS Code config', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return '';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        return undefined;
      },
    };
    expect(() => loadConfigFromVsCode(mockConfig, [])).toThrow('coderag.embeddingUrl');
  });

  it('throws when dbPath is missing from VS Code config', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return '';
        return undefined;
      },
    };
    expect(() => loadConfigFromVsCode(mockConfig, [])).toThrow('coderag.dbPath');
  });

  it('uses workspace folder as default docsInclude when not configured', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, ['/workspace/myproject']);
    expect(config.globs.docsInclude).toEqual(['/workspace/myproject/**/*.{md,mdx}']);
  });

  it('reads docsInclude array from VS Code configuration', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        if (key === 'docsInclude') return ['/docs/**/*.md', '/notes/**/*.md'];
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.globs.docsInclude).toEqual(['/docs/**/*.md', '/notes/**/*.md']);
  });

  it('defaults useGitignore to true when not set', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        return undefined;
      },
    };
    expect(loadConfigFromVsCode(mockConfig, []).useGitignore).toBe(true);
  });

  it('allows useGitignore to be explicitly disabled', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'dbPath') return './coderag.db';
        if (key === 'useGitignore') return false;
        return undefined;
      },
    };
    expect(loadConfigFromVsCode(mockConfig, []).useGitignore).toBe(false);
  });
});

describe('loadConfigFromEnv — additional coverage', () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  const setRequired = () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_DB_PATH'] = '/tmp/test.db';
  };

  it('parses CODERAG_CODE_INCLUDE as semicolon-separated patterns', () => {
    setRequired();
    process.env['CODERAG_CODE_INCLUDE'] = '**/*.ts;**/*.py;**/*.go';
    const config = loadConfigFromEnv();
    expect(config.globs.codeInclude).toEqual(['**/*.ts', '**/*.py', '**/*.go']);
  });

  it('trims whitespace around semicolons in pattern lists', () => {
    setRequired();
    process.env['CODERAG_DOCS_INCLUDE'] = '**/*.md ; docs/** ; notes/**';
    const config = loadConfigFromEnv();
    expect(config.globs.docsInclude).toEqual(['**/*.md', 'docs/**', 'notes/**']);
  });

  it('ignores empty segments from extra semicolons', () => {
    setRequired();
    process.env['CODERAG_DOCS_INCLUDE'] = ';**/*.md;;docs/**;';
    const config = loadConfigFromEnv();
    expect(config.globs.docsInclude).toEqual(['**/*.md', 'docs/**']);
  });

  it('defaults useGitignore to true when env var is not set', () => {
    setRequired();
    delete process.env['CODERAG_USE_GITIGNORE'];
    expect(loadConfigFromEnv().useGitignore).toBe(true);
  });

  it('CODERAG_USE_GITIGNORE=false disables gitignore', () => {
    setRequired();
    process.env['CODERAG_USE_GITIGNORE'] = 'false';
    expect(loadConfigFromEnv().useGitignore).toBe(false);
  });

  it('CODERAG_USE_GITIGNORE=0 disables gitignore', () => {
    setRequired();
    process.env['CODERAG_USE_GITIGNORE'] = '0';
    expect(loadConfigFromEnv().useGitignore).toBe(false);
  });
});

describe('loadConfigFromVsCode — additional coverage', () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    get: (key: string): unknown => ({
      embeddingUrl: 'http://localhost:11434/v1',
      embeddingModel: 'nomic-embed-text',
      dbPath: './coderag.db',
      ...extra,
    }[key]),
  });

  it('reads codeInclude array from VS Code configuration', () => {
    const cfg = base({ codeInclude: ['**/*.ts', '**/*.go'] });
    const config = loadConfigFromVsCode(cfg, []);
    expect(config.globs.codeInclude).toEqual(['**/*.ts', '**/*.go']);
  });

  it('reads codeExclude semicolon string from VS Code configuration', () => {
    const cfg = base({ codeExclude: '**/*.test.ts;dist/**' });
    const config = loadConfigFromVsCode(cfg, []);
    expect(config.globs.codeExclude).toEqual(['**/*.test.ts', 'dist/**']);
  });

  it('uses DEFAULT_CODE_INCLUDE when codeInclude is not set', () => {
    const cfg = base();
    const config = loadConfigFromVsCode(cfg, []);
    expect(config.globs.codeInclude.length).toBeGreaterThan(0);
  });

  it('uses workspace folder as default docsInclude prefix', () => {
    const cfg = base();
    const config = loadConfigFromVsCode(cfg, ['/my/project']);
    expect(config.globs.docsInclude[0]).toContain('/my/project');
  });

  it('uses DEFAULT_DOCS_INCLUDE when workspace folders are empty and docsInclude not set', () => {
    const cfg = base();
    const config = loadConfigFromVsCode(cfg, []);
    expect(config.globs.docsInclude.length).toBeGreaterThan(0);
  });
});
