import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import { registerSearch } from '../../../src/tools/search.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const VEC = [0.9, 0.1, 0.1, 0.1];
let db: VectorDB;
let description = '';
let handler: Handler;

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
  const server = {
    registerTool: (name: string, config: { description: string }, h: Handler): void => {
      if (name === 'search') {
        description = config.description;
        handler = h;
      }
    },
  } as unknown as McpServer;
  registerSearch(server, db, { embed: vi.fn().mockResolvedValue(VEC) } as unknown as Embedder, 5, new PathGuard(['/']));
});
afterEach(() => {
  db.close();
});

async function run(input: unknown): Promise<string> {
  return (await handler(input)).content[0]?.text ?? '';
}

describe('search tool scores', () => {
  it('explains the score in one short line of the description', () => {
    expect(description).toMatch(/0-1 score/);
    expect(description).toMatch(/hybrid.*1 = .*both/);
    expect(description.length).toBeLessThan(400);
  });

  it('shows a hit ranked first by both searches with score 1.00 and a keyword-only hit with less', async () => {
    db.insertDocument('/docs/auth.md', new Date(), [{ content: 'Authentication guide', position: 0 }], [VEC]);
    db.insertDocument('/docs/other.md', new Date(), [{ content: 'unrelated words', position: 0 }], [[0.1, 0.9, 0.1, 0.1]]);
    const out = await run({ query: 'authentication', mode: 'hybrid' });
    expect(out.split('\n')[0]).toMatch(/^docs\/auth\.md.*\(1\.00\)$/);
    expect(out).toMatch(/docs\/other\.md.*\(0\.[0-4]\d\)/);
  });

  it('shows keyword scores relative to the best hit', async () => {
    db.insertDocument('/docs/a.md', new Date(), [{ content: 'alpha alpha alpha', position: 0 }], [VEC]);
    db.insertDocument('/docs/b.md', new Date(), [{ content: 'alpha beta gamma delta epsilon zeta eta theta iota', position: 0 }], [VEC]);
    const headers = (await run({ query: 'alpha', mode: 'keyword' })).split('\n').filter((l) => /^\S/.test(l));
    expect(headers[0]).toMatch(/\(1\.00\)$/);
    expect(headers[1]).toMatch(/\(0\.\d\d\)$/);
  });

  it('no longer claims that keyword mode needs every word', async () => {
    const out = await run({ query: 'zzzz', mode: 'keyword' });
    expect(out).toMatch(/^No results\./);
    expect(out).not.toContain('every word');
    expect(out).toContain('hybrid');
  });
});
