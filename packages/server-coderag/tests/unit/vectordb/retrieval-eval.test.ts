import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EVAL_FETCH, evaluate, type EvalSummary } from '../../../scripts/lib/retrieval-eval.js';
import { LABELLED_QUERIES } from '../../../scripts/lib/retrieval-queries.js';
import { refIsAvailable, indexPinnedCorpus, type PinnedCorpus } from '../../../scripts/lib/corpus.js';

/**
 * Retrieval regression guard: 52 labelled queries over the pinned snapshot of this repository (see
 * scripts/lib/corpus.ts), network-free. Run `pnpm --filter @mcp-servers/server-coderag run eval` for the table.
 * The thresholds sit a little below the values reached when the identifier-aware keyword search landed
 * (keyword 0.942 / 1.000 / 0.798, hybrid 0.846 / 0.962 / 0.683). The hybrid row only shows the FTS leg's
 * contribution: its semantic leg is a hashed bag of words, not a real embedder.
 */
const available = refIsAvailable();

describe('labelled query set', () => {
  it('has at least 30 queries covering every kind, each with a target', () => {
    expect(LABELLED_QUERIES.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set(LABELLED_QUERIES.map((q) => q.kind));
    expect([...kinds].sort()).toEqual(['camel-fragment', 'concept', 'docs', 'identifier', 'natural', 'snake-kebab']);
    expect(LABELLED_QUERIES.every((q) => q.expect.length > 0)).toBe(true);
    expect(new Set(LABELLED_QUERIES.map((q) => q.query)).size).toBe(LABELLED_QUERIES.length);
  });
});

describe.skipIf(!available)('retrieval quality on the pinned snapshot', () => {
  let corpus: PinnedCorpus;
  let keyword: EvalSummary;
  let hybrid: EvalSummary;

  beforeAll(async () => {
    corpus = await indexPinnedCorpus();
    keyword = await evaluate(LABELLED_QUERIES, (q) => corpus.db.searchByKeyword(q, EVAL_FETCH, null));
    hybrid = await evaluate(LABELLED_QUERIES, async (q) => corpus.db.searchHybrid(await corpus.embedder.embed(q), q, EVAL_FETCH, null));
  }, 60_000);
  afterAll(() => {
    corpus.dispose();
  });

  it('keyword search answers every query and finds the target near the top', () => {
    expect(keyword.empty).toBe(0);
    expect(keyword.recallAt5).toBeGreaterThanOrEqual(0.9);
    expect(keyword.recallAt10).toBeGreaterThanOrEqual(0.96);
    expect(keyword.mrr).toBeGreaterThanOrEqual(0.76);
  });

  it('identifier and camelCase fragment queries are found in the top 3 by keyword search', () => {
    const rows = keyword.outcomes.filter((o) => o.kind === 'identifier' || o.kind === 'camel-fragment');
    const misses = rows.filter((o) => o.rank === null || o.rank > 3).map((o) => o.query);
    expect(misses).toEqual([]);
  });

  it('hybrid search keeps the contribution of the keyword leg', () => {
    expect(hybrid.empty).toBe(0);
    expect(hybrid.recallAt5).toBeGreaterThanOrEqual(0.8);
    expect(hybrid.recallAt10).toBeGreaterThanOrEqual(0.92);
    expect(hybrid.mrr).toBeGreaterThanOrEqual(0.64);
  });
});
