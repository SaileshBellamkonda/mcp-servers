import type { SearchResult } from '../../src/core/types.js';
import type { LabelledQuery, QueryKind, Target } from './retrieval-queries.js';

/** True when the hit lies in the target's file and, if the target names a symbol, is that symbol or one of its members. */
export function matchesTarget(hit: SearchResult, target: Target): boolean {
  if (!hit.document.replaceAll('\\', '/').endsWith(`/${target.file}`)) return false;
  if (target.symbol === undefined) return true;
  return hit.metadata?.symbolName === target.symbol || hit.metadata?.parentSymbol === target.symbol;
}

/** 1-based rank of the first relevant hit, or null. */
export function firstRelevantRank(hits: readonly SearchResult[], query: LabelledQuery): number | null {
  const index = hits.findIndex((hit) => query.expect.some((target) => matchesTarget(hit, target)));
  return index < 0 ? null : index + 1;
}

export interface QueryOutcome {
  query: string;
  kind: QueryKind;
  results: number;
  rank: number | null;
}

export interface EvalSummary {
  queries: number;
  /** Share of queries with a relevant hit in the first 5 / 10 results. */
  recallAt5: number;
  recallAt10: number;
  /** Mean reciprocal rank of the first relevant hit (0 when none is returned). */
  mrr: number;
  /** Queries that returned no result at all. */
  empty: number;
  outcomes: QueryOutcome[];
}

export const EVAL_FETCH = 10;

/** Runs every query through `search` (which must return at least the top 10 hits) and aggregates the metrics. */
export async function evaluate(
  queries: readonly LabelledQuery[],
  search: (query: string) => SearchResult[] | Promise<SearchResult[]>,
): Promise<EvalSummary> {
  const outcomes: QueryOutcome[] = [];
  for (const labelled of queries) {
    const hits = (await search(labelled.query)).slice(0, EVAL_FETCH);
    outcomes.push({ query: labelled.query, kind: labelled.kind, results: hits.length, rank: firstRelevantRank(hits, labelled) });
  }
  const n = outcomes.length;
  const within = (k: number): number => outcomes.filter((o) => o.rank !== null && o.rank <= k).length / n;
  return {
    queries: n,
    recallAt5: within(5),
    recallAt10: within(10),
    mrr: outcomes.reduce((sum, o) => sum + (o.rank === null ? 0 : 1 / o.rank), 0) / n,
    empty: outcomes.filter((o) => o.results === 0).length,
    outcomes,
  };
}

export function formatSummary(label: string, summary: EvalSummary): string {
  return `${label.padEnd(8)} recall@5=${summary.recallAt5.toFixed(3)} recall@10=${summary.recallAt10.toFixed(3)} mrr=${summary.mrr.toFixed(3)} empty=${String(summary.empty)}/${String(summary.queries)}`;
}
