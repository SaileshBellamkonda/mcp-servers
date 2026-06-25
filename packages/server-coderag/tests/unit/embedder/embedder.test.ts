import { describe, it, expect, vi } from 'vitest';
import { Embedder } from '../../../src/embedder/embedder.js';
import type { EmbeddingConfig } from '../../../src/core/types.js';

const baseConfig: EmbeddingConfig = {
  url: 'http://localhost:11434/v1',
  model: 'nomic-embed-text',
  batchSize: 100,
};

function makeMockFetch(embeddings: number[][]): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: embeddings.map((e, i) => ({ index: i, embedding: e })),
    }),
  } as Response);
}

describe('Embedder.embed', () => {
  it('calls the embeddings endpoint with correct body', async () => {
    const mockFetch = makeMockFetch([[0.1, 0.2, 0.3]]);
    const embedder = new Embedder(baseConfig, mockFetch);
    const result = await embedder.embed('hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/embeddings');
    const body = JSON.parse(opts.body as string) as { input: string[]; model: string };
    expect(body.input).toEqual(['hello world']);
    expect(body.model).toBe('nomic-embed-text');
  });

  it('sends Authorization header when apiKey is set', async () => {
    const mockFetch = makeMockFetch([[0.1]]);
    const configWithKey = { ...baseConfig, apiKey: 'sk-test' };
    const embedder = new Embedder(configWithKey, mockFetch);
    await embedder.embed('test');
    const [, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });

  it('does not send Authorization header when apiKey is absent', async () => {
    const mockFetch = makeMockFetch([[0.1]]);
    const embedder = new Embedder(baseConfig, mockFetch);
    await embedder.embed('test');
    const [, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('Embedder.embedBatch', () => {
  it('returns embeddings for multiple texts', async () => {
    const mockFetch = makeMockFetch([[0.1, 0.2], [0.3, 0.4]]);
    const embedder = new Embedder(baseConfig, mockFetch);
    const result = await embedder.embedBatch(['text1', 'text2']);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('splits into batches when input exceeds batchSize', async () => {
    const smallBatchConfig = { ...baseConfig, batchSize: 2 };
    // 3 texts → 2 batches: [2, 1]
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ data: [{ index: 0, embedding: [0.1] }, { index: 1, embedding: [0.2] }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ data: [{ index: 0, embedding: [0.3] }] }),
      } as Response);
    const embedder = new Embedder(smallBatchConfig, mockFetch);
    const result = await embedder.embedBatch(['a', 'b', 'c']);
    expect(result).toEqual([[0.1], [0.2], [0.3]]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty array for empty input', async () => {
    const mockFetch = vi.fn();
    const embedder = new Embedder(baseConfig, mockFetch);
    const result = await embedder.embedBatch([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws on non-OK HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      text: async () => 'Unauthorized',
    } as Response);
    const embedder = new Embedder(baseConfig, mockFetch);
    await expect(embedder.embedBatch(['test'])).rejects.toThrow('401');
  });
});

describe('Embedder.detectDimensions', () => {
  it('returns the dimension count of the first embedding', async () => {
    const mockFetch = makeMockFetch([[0.1, 0.2, 0.3, 0.4, 0.5]]);
    const embedder = new Embedder(baseConfig, mockFetch);
    const dims = await embedder.detectDimensions();
    expect(dims).toBe(5);
  });
});
