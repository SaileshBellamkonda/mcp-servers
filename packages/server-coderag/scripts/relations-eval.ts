/**
 * Network-free quality check of `search_relations`: indexes the pinned snapshot (see lib/corpus.ts) and answers the
 * labelled questions of lib/relations-queries.ts, printing precision and recall per relation kind.
 * Run: `pnpm --filter @mcp-servers/server-coderag run eval:relations`.
 */
import { evaluateRelations, formatRelationSummary } from './lib/relations-eval.js';
import { RELATION_QUESTIONS } from './lib/relations-queries.js';
import { DEFAULT_DIM, DEFAULT_REF, indexPinnedCorpus } from './lib/corpus.js';

const corpus = await indexPinnedCorpus(process.env['BENCH_REF'] ?? DEFAULT_REF, Number(process.env['BENCH_DIM'] ?? String(DEFAULT_DIM)));
try {
  console.log(`corpus: ${String(corpus.codeIndexed)} code files, ${String(corpus.db.getRelationCount())} relations`);
  console.log(formatRelationSummary(evaluateRelations(corpus.db, RELATION_QUESTIONS)));
} finally {
  corpus.dispose();
}
