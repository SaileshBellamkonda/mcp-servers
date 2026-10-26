/**
 * Network-free benchmark of the `search` tool's response size.
 *
 * Indexes a pinned snapshot of this repository (packages/server-coderag/src, packages/shared and the Markdown
 * files) with a deterministic bag-of-hashed-tokens embedder, then runs a fixed list of queries through the real
 * `search` handler in each mode and reports response characters, estimated tokens (chars / 4), result count and
 * empty results. Run: `pnpm --filter @mcp-servers/server-coderag run bench`.
 *
 * Env: BENCH_REF (git ref of the corpus, default bdb73d5), BENCH_DIM (vector size, default 768), BENCH_MODES
 * (comma list, default hybrid,keyword,semantic), BENCH_SHOW=1 (also print every response).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { SyncManager } from '../src/indexer/sync-manager.js';
import { createCodeRagServer } from '../src/server/coderag-server.js';
import { DEFAULT_DIM, DEFAULT_REF, indexPinnedCorpus } from './lib/corpus.js';

const REF = process.env['BENCH_REF'] ?? DEFAULT_REF;
const DIM = Number(process.env['BENCH_DIM'] ?? String(DEFAULT_DIM));
const MODES = (process.env['BENCH_MODES'] ?? 'hybrid,keyword,semantic').split(',');

const QUERIES = [
  'how are embeddings requested from the API',
  'path confinement for file access',
  'PathGuard assertAllowedReal',
  'split markdown into sections by heading',
  'reciprocal rank fusion hybrid search',
  'register a tool with the MCP server',
  'bearer token authentication http host',
  'extractSignature',
  'tree-sitter grammar loading',
  'startup sync when the rules changed',
  'sqlite vec table dimensions mismatch',
  'redact api key from error messages',
];

/** Number of hits in a response: `count` of the JSON format, or the entry headers of the concise text format. */
function countResults(text: string): number {
  if (text.startsWith('{')) return (JSON.parse(text) as { count: number }).count;
  return text.split('\n').filter((l) => /^\S+ .*\(\d+\.\d\d\)$/.test(l)).length;
}

function percentile90(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const corpus = await indexPinnedCorpus(REF, DIM);
  const { root, db, embedder, indexer, guard } = corpus;
  try {
    console.log(`corpus ${REF}: ${String(corpus.docsIndexed)} docs, ${String(corpus.codeIndexed)} code files, ${String(db.getDocumentCount())} indexed, dim ${String(DIM)}`);

    const server = new McpServer({ name: 'bench', version: '0.0.0' }, { capabilities: { tools: {} } });
    createCodeRagServer(server, db, embedder, indexer, 5, [root], new SyncManager(), undefined, ':memory:', 'hash', guard);
    const search = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown) => Promise<{ content: { text: string }[] }> }> })
      ._registeredTools['search']?.handler;
    if (!search) throw new Error('search tool not registered');

    for (const mode of MODES) {
      console.log(`\nmode=${mode}\n${'query'.padEnd(50)} ${'chars'.padStart(7)} ${'tokens'.padStart(7)} ${'results'.padStart(8)} empty`);
      const tokens: number[] = [];
      let empties = 0;
      for (const query of QUERIES) {
        const text = (await search({ query, mode })).content[0]?.text ?? '';
        if (process.env['BENCH_SHOW']) console.log(`--- ${mode}: ${query}\n${text}\n---`);
        const results = countResults(text);
        const est = Math.ceil(text.length / 4);
        tokens.push(est);
        if (results === 0) empties++;
        console.log(`${query.slice(0, 50).padEnd(50)} ${String(text.length).padStart(7)} ${String(est).padStart(7)} ${String(results).padStart(8)} ${results === 0 ? 'yes' : ''}`);
      }
      const mean = tokens.reduce((a, b) => a + b, 0) / tokens.length;
      console.log(`SUMMARY mode=${mode} mean_tokens=${mean.toFixed(0)} p90_tokens=${String(percentile90(tokens))} empty=${String(empties)}/${String(QUERIES.length)}`);
    }
  } finally {
    corpus.dispose();
  }
}

await main();
