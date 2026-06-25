import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFromEnv, loadConfigFromVsCode } from '../../../src/core/config.js';

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
    expect(() => loadConfigFromEnv()).toThrow('CODERAG_EMBEDDING_URL');
  });

  it('throws when CODERAG_EMBEDDING_MODEL is missing', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    delete process.env['CODERAG_EMBEDDING_MODEL'];
    expect(() => loadConfigFromEnv()).toThrow('CODERAG_EMBEDDING_MODEL');
  });

  it('returns config with required fields', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    const config = loadConfigFromEnv();
    expect(config.embedding.url).toBe('http://localhost:11434/v1');
    expect(config.embedding.model).toBe('nomic-embed-text');
  });

  it('applies default values for optional fields', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    delete process.env['CODERAG_DB_PATH'];
    delete process.env['CODERAG_DOCUMENTS_DIR'];
    delete process.env['CODERAG_CHUNK_SIZE'];
    delete process.env['CODERAG_TOP_K'];
    delete process.env['CODERAG_EXCLUDE'];
    delete process.env['CODERAG_USE_GITIGNORE'];
    delete process.env['CODERAG_EMBEDDING_DIM'];
    const config = loadConfigFromEnv();
    expect(config.dbPath).toBe('./coderag.db');
    expect(config.documentsDir).toBe('./documents');
    expect(config.chunkSize).toBe(500);
    expect(config.topK).toBe(5);
    expect(config.exclude).toEqual([]);
    expect(config.useGitignore).toBe(false);
    expect(config.embeddingDim).toBeUndefined();
  });

  it('parses CODERAG_EMBEDDING_DIM as integer', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_EMBEDDING_DIM'] = '768';
    const config = loadConfigFromEnv();
    expect(config.embeddingDim).toBe(768);
  });

  it('parses CODERAG_EXCLUDE as comma-separated patterns', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_EXCLUDE'] = '**/*.test.ts, dist/**, node_modules';
    const config = loadConfigFromEnv();
    expect(config.exclude).toEqual(['**/*.test.ts', 'dist/**', 'node_modules']);
  });

  it('parses CODERAG_USE_GITIGNORE as boolean', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'http://localhost:11434/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'nomic-embed-text';
    process.env['CODERAG_USE_GITIGNORE'] = 'true';
    expect(loadConfigFromEnv().useGitignore).toBe(true);
    process.env['CODERAG_USE_GITIGNORE'] = '1';
    expect(loadConfigFromEnv().useGitignore).toBe(true);
    process.env['CODERAG_USE_GITIGNORE'] = 'yes';
    expect(loadConfigFromEnv().useGitignore).toBe(true);
    process.env['CODERAG_USE_GITIGNORE'] = 'false';
    expect(loadConfigFromEnv().useGitignore).toBe(false);
  });

  it('reads optional fields from environment', () => {
    process.env['CODERAG_EMBEDDING_URL'] = 'https://api.openai.com/v1';
    process.env['CODERAG_EMBEDDING_MODEL'] = 'text-embedding-3-small';
    process.env['CODERAG_EMBEDDING_API_KEY'] = 'sk-test';
    process.env['CODERAG_DB_PATH'] = '/data/mydb.db';
    process.env['CODERAG_DOCUMENTS_DIR'] = '/data/docs';
    process.env['CODERAG_CHUNK_SIZE'] = '1000';
    process.env['CODERAG_TOP_K'] = '10';
    const config = loadConfigFromEnv();
    expect(config.embedding.apiKey).toBe('sk-test');
    expect(config.dbPath).toBe('/data/mydb.db');
    expect(config.documentsDir).toBe('/data/docs');
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
          documentsDir: './documents',
          chunkSize: 500,
          topK: 5,
        };
        return vals[key];
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.embedding.url).toBe('http://localhost:11434/v1');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.exclude).toEqual([]);
    expect(config.useGitignore).toBe(false);
  });

  it('reads exclude array from VS Code configuration', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'exclude') return ['**/*.test.ts', 'dist/**'];
        if (key === 'useGitignore') return true;
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.exclude).toEqual(['**/*.test.ts', 'dist/**']);
    expect(config.useGitignore).toBe(true);
  });

  it('reads exclude as comma-separated string from VS Code configuration', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'exclude') return '**/*.spec.ts, dist/**';
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, []);
    expect(config.exclude).toEqual(['**/*.spec.ts', 'dist/**']);
  });

  it('throws when embeddingUrl is missing from VS Code config', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return '';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        return undefined;
      },
    };
    expect(() => loadConfigFromVsCode(mockConfig, [])).toThrow('coderag.embeddingUrl');
  });

  it('uses workspace folder as documentsDir when not configured', () => {
    const mockConfig = {
      get: (key: string): unknown => {
        if (key === 'embeddingUrl') return 'http://localhost:11434/v1';
        if (key === 'embeddingModel') return 'nomic-embed-text';
        if (key === 'documentsDir') return '';
        return undefined;
      },
    };
    const config = loadConfigFromVsCode(mockConfig, ['/workspace/myproject']);
    expect(config.documentsDir).toBe('/workspace/myproject');
  });
});
