import { describe, it, expect } from 'vitest';
import { loadConfigFromEnv, loadConfigFromVsCode } from '../../../src/core/config.ts';
import { ConfigError } from '../../../src/core/types.ts';

const baseEnv = {
  CODERAG_EMBEDDING_URL: 'http://localhost:11434/v1',
  CODERAG_EMBEDDING_MODEL: 'nomic-embed-text',
  CODERAG_DB_PATH: '/tmp/test.db',
};

function vsConfig(extra: Record<string, unknown> = {}): { get(key: string): unknown } {
  const values: Record<string, unknown> = { embeddingUrl: 'http://localhost:11434/v1', embeddingModel: 'm', dbPath: './c.db', ...extra };
  return { get: (key) => values[key] };
}

describe('CODERAG_EMBED_MAX_CHARS', () => {
  it('defaults to 6000', () => {
    expect(loadConfigFromEnv(baseEnv).embedding.maxChars).toBe(6000);
  });

  it('reads a positive limit', () => {
    expect(loadConfigFromEnv({ ...baseEnv, CODERAG_EMBED_MAX_CHARS: '2500' }).embedding.maxChars).toBe(2500);
  });

  it('accepts 0, which disables the limit', () => {
    expect(loadConfigFromEnv({ ...baseEnv, CODERAG_EMBED_MAX_CHARS: '0' }).embedding.maxChars).toBe(0);
  });

  it('treats an empty value as unset', () => {
    expect(loadConfigFromEnv({ ...baseEnv, CODERAG_EMBED_MAX_CHARS: '' }).embedding.maxChars).toBe(6000);
  });

  it.each(['abc', '-5', '12.5', '1e3'])('rejects %s and names the variable', (value) => {
    const load = (): unknown => loadConfigFromEnv({ ...baseEnv, CODERAG_EMBED_MAX_CHARS: value });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow('CODERAG_EMBED_MAX_CHARS');
  });
});

describe('embedMaxChars in the VS Code configuration', () => {
  it('defaults to 6000 when unset', () => {
    expect(loadConfigFromVsCode(vsConfig(), []).embedding.maxChars).toBe(6000);
  });

  it('reads an integer, including 0', () => {
    expect(loadConfigFromVsCode(vsConfig({ embedMaxChars: 1200 }), []).embedding.maxChars).toBe(1200);
    expect(loadConfigFromVsCode(vsConfig({ embedMaxChars: 0 }), []).embedding.maxChars).toBe(0);
  });

  it('falls back to the default for a negative, fractional or non-numeric value', () => {
    for (const value of [-1, 1.5, 'x', null]) {
      expect(loadConfigFromVsCode(vsConfig({ embedMaxChars: value }), []).embedding.maxChars).toBe(6000);
    }
  });
});
