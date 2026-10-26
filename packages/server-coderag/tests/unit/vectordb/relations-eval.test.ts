import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { evaluateRelations, type RelationEvalSummary } from '../../../scripts/lib/relations-eval.js';
import { RELATION_QUESTIONS, VERIFIED_CALL_SAMPLE } from '../../../scripts/lib/relations-queries.js';
import { refIsAvailable, indexPinnedCorpus, type PinnedCorpus } from '../../../scripts/lib/corpus.js';

/**
 * Quality guard for `search_relations`: labelled questions over the pinned snapshot of this repository (see
 * scripts/lib/corpus.ts), network-free. Run `pnpm --filter @mcp-servers/server-coderag run eval:relations` for the table.
 * The thresholds sit a little below what was reached when relations landed (calls precision 1.000, recall 0.991;
 * imports and inherits 1.000 / 1.000). The snapshot is TypeScript only; the other languages are covered by the
 * real-grammar extraction tests.
 */
const available = refIsAvailable();

describe('labelled relation questions', () => {
  it('has at least 15 questions of every kind, each with expected items', () => {
    expect(RELATION_QUESTIONS.length).toBeGreaterThanOrEqual(15);
    expect([...new Set(RELATION_QUESTIONS.map((q) => q.kind))].sort()).toEqual(['callees', 'callers', 'importers', 'imports', 'inheritors']);
    expect(RELATION_QUESTIONS.every((q) => q.expect.length > 0)).toBe(true);
    expect(new Set(RELATION_QUESTIONS.map((q) => q.question)).size).toBe(RELATION_QUESTIONS.length);
  });

  it('keeps the 20 hand-verified call edges', () => {
    expect(VERIFIED_CALL_SAMPLE).toHaveLength(20);
  });
});

describe.skipIf(!available)('relation quality on the pinned snapshot', () => {
  let corpus: PinnedCorpus;
  let summary: RelationEvalSummary;

  beforeAll(async () => {
    corpus = await indexPinnedCorpus();
    summary = evaluateRelations(corpus.db, RELATION_QUESTIONS);
  }, 60_000);
  afterAll(() => {
    corpus.dispose();
  });

  it('answers who-calls and what-does-it-call with few wrong and few missing callers', () => {
    expect(summary.calls.precision).toBeGreaterThanOrEqual(0.97);
    expect(summary.calls.recall).toBeGreaterThanOrEqual(0.96);
  });

  it('answers what a file imports and who imports it', () => {
    expect(summary.imports.precision).toBeGreaterThanOrEqual(0.97);
    expect(summary.imports.recall).toBeGreaterThanOrEqual(0.97);
  });

  it('answers who extends or implements a type', () => {
    expect(summary.inherits.precision).toBeGreaterThanOrEqual(0.97);
    expect(summary.inherits.recall).toBeGreaterThanOrEqual(0.97);
  });

  it('finds every hand-verified call edge, resolved to the right symbol', () => {
    const problems: string[] = [];
    for (const sample of VERIFIED_CALL_SAMPLE) {
      const [file, line] = sample.at.split(':') as [string, string];
      const [parent, name] = sample.inside.includes('.') ? (sample.inside.split('.') as [string, string]) : ['', sample.inside];
      const hits = corpus.db
        .queryRelations({ symbol: sample.inside, direction: 'out', types: ['calls'], limit: 1000, offset: 0 })
        .hits.filter((h) => h.source.file.endsWith(`/${file}`) && h.source.name === name && h.source.parent === parent && h.targetName === sample.callee && h.line === Number(line));
      const hit = hits[0];
      if (!hit) {
        problems.push(`${sample.at} ${sample.inside} -> ${sample.callee}: not recorded`);
      } else if (sample.resolvedTo === undefined ? hit.target !== undefined : !hit.target || `${hit.target.file.slice(hit.target.file.indexOf('packages/') + 'packages/'.length)}:${String(hit.target.startLine)}` !== sample.resolvedTo) {
        problems.push(`${sample.at} ${sample.inside} -> ${sample.callee}: resolved to ${hit.target ? `${hit.target.file}:${String(hit.target.startLine)}` : 'nothing'}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
