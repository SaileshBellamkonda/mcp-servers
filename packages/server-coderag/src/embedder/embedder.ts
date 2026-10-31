import type { EmbeddingConfig } from '../core/types.ts';

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

const MAX_ERROR_BODY_CHARS = 200;
const BEARER_TOKEN = /\bBearer\s+[^\s"',;]+/gi;

/**
 * Makes an upstream error body safe to put in an error message, log line or tool result: the configured
 * key and any `Bearer <token>` are redacted first (so truncation cannot leave a partial secret), then the
 * text is cut to a short excerpt.
 */
function sanitizeErrorBody(body: string, apiKey: string | undefined): string {
  let text = body;
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  text = text.replace(BEARER_TOKEN, 'Bearer [REDACTED]');
  return text.length > MAX_ERROR_BODY_CHARS ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}... (truncated)` : text;
}

/**
 * The text as it is sent to the embedding endpoint: at most `maxChars` UTF-16 code units, cut after the last whole line
 * when that keeps at least half of them (else mid-line), never between the halves of a surrogate pair. `undefined` or
 * 0 means no limit.
 */
export function truncateForEmbedding(text: string, maxChars: number | undefined): string {
  if (maxChars === undefined || maxChars <= 0 || text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const lastLine = head.lastIndexOf('\n');
  if (lastLine >= maxChars / 2) return head.slice(0, lastLine);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
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
      body: JSON.stringify({ model: this.config.model, input: texts.map((text) => truncateForEmbedding(text, this.config.maxChars)) }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API returned ${String(response.status)}: ${sanitizeErrorBody(errorText, this.config.apiKey)}`);
    }

    const json = (await response.json()) as EmbeddingResponse;

    // Sort by index to preserve order (API may return out-of-order)
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
