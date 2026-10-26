/**
 * Network-free retrieval eval: labelled queries over the pinned snapshot, scored with recall@5, recall@10 and MRR.
 *
 * `keyword` is the FTS5 leg alone. `hybrid` fuses it with the semantic leg of a deterministic hashed-token embedder,
 * so compare it with the `semantic` row to see the FTS contribution; real semantic quality needs a real embedder and is not measured here.
 * Run: `pnpm --filter @mcp-servers/server-coderag run eval`. Env: BENCH_REF, BENCH_DIM, EVAL_SHOW=1 (per-query ranks).
 */
import { DEFAULT_DIM, DEFAULT_REF, indexPinnedCorpus } from './lib/corpus.js';
import { EVAL_FETCH, evaluate, formatSummary } from './lib/retrieval-eval.js';
import { LABELLED_QUERIES } from './lib/retrieval-queries.js';

const ref = process.env['BENCH_REF'] ?? DEFAULT_REF;
const dim = Number(process.env['BENCH_DIM'] ?? String(DEFAULT_DIM));
const corpus = await indexPinnedCorpus(ref, dim);
try {
  console.log(`corpus ${ref}: ${String(corpus.db.getDocumentCount())} documents, ${String(LABELLED_QUERIES.length)} labelled queries`);
  const keyword = await evaluate(LABELLED_QUERIES, (q) => corpus.db.searchByKeyword(q, EVAL_FETCH, null));
  const hybrid = await evaluate(LABELLED_QUERIES, async (q) => corpus.db.searchHybrid(await corpus.embedder.embed(q), q, EVAL_FETCH, null));
  const semantic = await evaluate(LABELLED_QUERIES, async (q) => corpus.db.searchWithFilter(await corpus.embedder.embed(q), EVAL_FETCH, null));
  console.log(formatSummary('keyword', keyword));
  console.log(formatSummary('semantic', semantic));
  console.log(formatSummary('hybrid', hybrid));
  if (process.env['EVAL_SHOW']) {
    for (const [i, o] of keyword.outcomes.entries()) {
      const h = hybrid.outcomes[i];
      console.log(`${o.kind.padEnd(14)} kw=${String(o.rank ?? '-').padStart(2)} (${String(o.results).padStart(2)} hits) hy=${String(h?.rank ?? '-').padStart(2)}  ${o.query}`);
    }
  }
} finally {
  corpus.dispose();
}
