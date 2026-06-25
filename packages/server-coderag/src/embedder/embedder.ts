import type { EmbeddingConfig } from '../core/types.js';

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

export class Embedder {
  private readonly config: EmbeddingConfig;
  private readonly fetchFn: typeof fetch;

  constructor(config: EmbeddingConfig, fetchFn: typeof fetch = globalThis.fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = this.config.batchSize;
    const results: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize);
      const batchResults = await this.callApi(batch);
      results.push(...batchResults);
    }

    return results;
  }

  async detectDimensions(): Promise<number> {
    const result = await this.embedBatch(['probe']);
    const first = result[0];
    if (!first || first.length === 0) {
      throw new Error('Embedding API returned empty vector — cannot detect dimensions');
    }
    return first.length;
  }

  private async callApi(texts: string[]): Promise<number[][]> {
    const url = `${this.config.url.replace(/\/$/, '')}/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API returned ${String(response.status)}: ${errorText}`);
    }

    const json = (await response.json()) as EmbeddingResponse;

    // Sort by index to preserve order (API may return out-of-order)
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
