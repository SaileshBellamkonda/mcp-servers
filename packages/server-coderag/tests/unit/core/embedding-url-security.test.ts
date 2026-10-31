import { describe, it, expect } from 'vitest';
import { loadConfigFromEnv, loadConfigFromVsCode } from '../../../src/core/config.ts';
import { ConfigError } from '../../../src/core/types.ts';
import { activateCodeRagServer } from '../../../src/embedded.ts';

const KEY = 'sk-super-secret-key';

function env(url: string, apiKey?: string): Record<string, string> {
  return {
    CODERAG_EMBEDDING_URL: url,
    CODERAG_EMBEDDING_MODEL: 'm',
    CODERAG_DB_PATH: '/tmp/x.db',
    ...(apiKey !== undefined && { CODERAG_EMBEDDING_API_KEY: apiKey }),
  };
}

function vs(url: string, apiKey?: string): { get: (key: string) => unknown } {
  const values: Record<string, unknown> = { embeddingUrl: url, embeddingModel: 'm', dbPath: '/tmp/x.db', embeddingApiKey: apiKey };
  return { get: (key) => values[key] };
}

describe('embedding URL scheme check (env)', () => {
  it('rejects an API key sent over http:// to a remote host, naming the variable and not the key', () => {
    let error: unknown;
    try { loadConfigFromEnv(env('http://embeddings.example.com/v1', KEY)); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('CODERAG_EMBEDDING_URL');
    expect(message).toContain('CODERAG_EMBEDDING_API_KEY');
    expect(message).toContain('https');
    expect(message).not.toContain(KEY);
  });

  it.each([
    'https://api.openai.com/v1',
    'HTTPS://api.openai.com/v1',
    'http://localhost:11434/v1',
    'http://LOCALHOST:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.5.6.7/v1',
    'http://[::1]:11434/v1',
  ])('allows %s with an API key', (url) => {
    expect(loadConfigFromEnv(env(url, KEY)).embedding.url).toBe(url);
  });

  it.each(['http://embeddings.example.com/v1', 'http://10.0.0.5:8080/v1', 'http://localhost.evil.com/v1', 'http://127.0.0.1.evil.com/v1'])(
    'rejects %s with an API key',
    (url) => {
      expect(() => loadConfigFromEnv(env(url, KEY))).toThrow(ConfigError);
    },
  );

  it('allows http:// to a remote host when no API key is configured', () => {
    expect(loadConfigFromEnv(env('http://embeddings.example.com/v1')).embedding.apiKey).toBeUndefined();
    expect(() => loadConfigFromEnv(env('http://embeddings.example.com/v1', ''))).not.toThrow();
  });
});

describe('embedding URL scheme check (VS Code)', () => {
  it('rejects an API key sent over http:// to a remote host, naming the setting and not the key', () => {
    let error: unknown;
    try { loadConfigFromVsCode(vs('http://embeddings.example.com/v1', KEY), []); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('mcpServers.coderag.embeddingUrl');
    expect(message).toContain('https');
    expect(message).not.toContain(KEY);
  });

  it('allows https and loopback http with a key, and remote http without one', () => {
    expect(() => loadConfigFromVsCode(vs('https://api.openai.com/v1', KEY), [])).not.toThrow();
    expect(() => loadConfigFromVsCode(vs('http://localhost:11434/v1', KEY), [])).not.toThrow();
    expect(() => loadConfigFromVsCode(vs('http://embeddings.example.com/v1'), [])).not.toThrow();
  });
});

describe('embedding URL scheme check (key supplied separately to the embedded server)', () => {
  it('rejects the separately supplied API key over http:// to a remote host, without echoing it', async () => {
    const attempt = activateCodeRagServer({
      vsCodeConfig: vs('http://embeddings.example.com/v1'),
      workspaceFolders: [process.cwd()],
      port: 0,
      authToken: `embedded-token-${'e'.repeat(32)}`,
      apiKey: KEY,
    });
    await expect(attempt).rejects.toThrow(/mcpServers\.coderag\.embeddingUrl/);
    await expect(attempt).rejects.not.toThrow(KEY);
  });
});
