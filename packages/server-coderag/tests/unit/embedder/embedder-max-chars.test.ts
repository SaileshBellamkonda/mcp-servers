import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Embedder, truncateForEmbedding } from '../../../src/embedder/embedder.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { GlobMatcher } from '../../../src/core/glob-utils.js';

const DIM = 4;
let server: Server;
let baseUrl: string;
let requests: string[][];

beforeEach(async () => {
  requests = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { input: string[] };
      requests.push(body.input);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: body.input.map((_t, index) => ({ index, embedding: [0.5, 0.5, 0.5, 0.5] })) }));
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${String((server.address() as { port: number }).port)}/v1`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

const config = (maxChars: number | undefined, batchSize = 100) => ({ url: baseUrl, model: 'm', batchSize, ...(maxChars === undefined ? {} : { maxChars }) });

describe('truncateForEmbedding', () => {
  it('returns text within the limit, and any text when the limit is 0 or unset', () => {
    expect(truncateForEmbedding('abc', 3)).toBe('abc');
    expect(truncateForEmbedding('abcdef', 0)).toBe('abcdef');
    expect(truncateForEmbedding('abcdef', undefined)).toBe('abcdef');
  });

  it('cuts at the last line boundary within the limit', () => {
    const text = 'aaaa\nbbbb\ncccc\ndddd';
    expect(truncateForEmbedding(text, 12)).toBe('aaaa\nbbbb');
  });

  it('cuts mid-line when the only line break is too early to be worth it', () => {
    const text = `x\n${'y'.repeat(50)}`;
    expect(truncateForEmbedding(text, 20)).toBe(`x\n${'y'.repeat(18)}`);
  });

  it('never splits a surrogate pair', () => {
    const text = `${'a'.repeat(9)}😀${'b'.repeat(5)}`; // the emoji spans UTF-16 units 9 and 10
    const cut = truncateForEmbedding(text, 10);
    expect(cut).toBe('a'.repeat(9));
    expect(truncateForEmbedding(text, 11)).toBe(`${'a'.repeat(9)}😀`);
  });
});

describe('Embedder with maxChars, against an HTTP embedding server', () => {
  const long = Array.from({ length: 100 }, (_v, i) => `line ${String(i).padStart(3, '0')} of the chunk`).join('\n');

  it('sends a long text truncated to the limit and leaves short texts alone', async () => {
    const embedder = new Embedder(config(200));
    await embedder.embedBatch([long, 'short text']);
    expect(requests).toHaveLength(1);
    const [sentLong, sentShort] = requests[0] ?? [];
    expect(sentLong?.length).toBeLessThanOrEqual(200);
    expect(sentLong?.length).toBeGreaterThan(150);
    expect(long.startsWith(sentLong ?? 'x')).toBe(true);
    expect(sentLong?.endsWith('chunk')).toBe(true); // ends on a whole line
    expect(sentShort).toBe('short text');
  });

  it('truncates a query embedded through embed() too', async () => {
    await new Embedder(config(50)).embed('q'.repeat(500));
    expect(requests[0]?.[0]).toHaveLength(50);
  });

  it('0 disables the limit', async () => {
    await new Embedder(config(0)).embedBatch([long]);
    expect(requests[0]?.[0]).toBe(long);
  });

  it('without a configured limit nothing is truncated', async () => {
    await new Embedder(config(undefined)).embedBatch([long]);
    expect(requests[0]?.[0]).toBe(long);
  });

  it('keeps the batching: the same number of requests and inputs per request', async () => {
    await new Embedder(config(30, 2)).embedBatch([long, long, long, long, long]);
    expect(requests.map((r) => r.length)).toEqual([2, 2, 1]);
    expect(requests.flat().every((t) => t.length <= 30)).toBe(true);
  });
});

describe('indexing with maxChars', () => {
  let dir: string;
  let db: VectorDB;
  let indexer: Indexer;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-maxchars-'));
    db = VectorDB.open(':memory:', DIM);
  });

  afterEach(() => {
    indexer.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('truncates only what the embedder receives: stored chunk text and keyword text stay whole', async () => {
    const body = Array.from({ length: 60 }, (_v, i) => `  total += uniqueMarker${String(i)}(value);`).join('\n');
    const source = `export function big(value: number): number {\n  let total = 0;\n${body}\n  return total;\n}\n`;
    writeFileSync(path.join(dir, 'big.ts'), source);
    const glob = `${dir.replace(/\\/g, '/')}/**/*.ts`;
    indexer = new Indexer(db, new Embedder(config(300)), 500, { codeMatcher: new GlobMatcher([glob], [], dir) });
    await indexer.indexCodeFile(path.join(dir, 'big.ts'));

    expect(requests.flat()).toHaveLength(1);
    expect(requests.flat()[0]?.length).toBeLessThanOrEqual(300);
    expect(requests.flat()[0]).not.toContain('uniqueMarker59');

    const hits = db.searchByKeyword('uniqueMarker59', 5, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.chunk).toBe(source.replace('export ', '').trimEnd());
  });
});
