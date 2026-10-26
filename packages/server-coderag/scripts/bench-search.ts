/**
 * Network-free benchmark of the `search` tool's response size.
 *
 * Indexes a pinned snapshot of this repository (packages/server-coderag/src, packages/shared and the Markdown
 * files) with a deterministic bag-of-hashed-tokens embedder, then runs a fixed list of queries through the real
 * `search` handler in each mode and reports response characters, estimated tokens (chars / 4), result count and
 * empty results. Run: `pnpm --filter @mcp-servers/server-coderag run bench`.
 *
 * Env: BENCH_REF (git ref of the corpus, default bdb73d5), BENCH_DIM (vector size, default 768), BENCH_MODES
 * (comma list, default hybrid,keyword,semantic).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { Embedder } from '../src/embedder/embedder.js';
import { VectorDB } from '../src/vectordb/db.js';
import { Indexer } from '../src/indexer/indexer.js';
import { SyncManager } from '../src/indexer/sync-manager.js';
import { GlobMatcher } from '../src/core/glob-utils.js';
import { PathGuard } from '../src/core/path-guard.js';
import { createCodeRagServer } from '../src/server/coderag-server.js';

const REF = process.env['BENCH_REF'] ?? 'bdb73d5';
const DIM = Number(process.env['BENCH_DIM'] ?? '768');
const MODES = (process.env['BENCH_MODES'] ?? 'hybrid,keyword,semantic').split(',');
const CORPUS_PATHS = ['packages/server-coderag/src', 'packages/shared', 'packages/server-coderag/README.md', 'docs'];

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

/** FNV-1a, 32 bit. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Deterministic embedding: hashed lowercase word pieces (camelCase and snake_case split) into DIM buckets. */
function hashEmbedding(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const words = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    const h = fnv1a(word);
    vec[h % DIM] = (vec[h % DIM] ?? 0) + ((h >>> 16) % 2 === 0 ? 1 : -1);
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

const fakeFetch = ((_url: string, init?: RequestInit) => {
  const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { input: string[] };
  const data = body.input.map((text, index) => ({ index, embedding: hashEmbedding(text) }));
  return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}) as unknown as typeof fetch;

function countResults(text: string): number {
  if (text.startsWith('{')) return (JSON.parse(text) as { count: number }).count;
  return 0;
}

function percentile90(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const root = mkdtempSync(path.join(process.env['BENCH_TMP'] ?? tmpdir(), 'coderag-bench-'));
  try {
    const archive = execFileSync('git', ['archive', REF, ...CORPUS_PATHS], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', root], { input: archive });

    const embedder = new Embedder({ url: 'http://bench.invalid/v1', model: 'hash', batchSize: 64 }, fakeFetch);
    const db = VectorDB.open(':memory:', DIM);
    const guard = new PathGuard([root]);
    const quiet = { warn: () => undefined, pathGuard: guard };
    const docsMatcher = new GlobMatcher(['**/*.md'], [], root, false, quiet);
    const codeMatcher = new GlobMatcher(['**/*.ts'], [], root, false, quiet);
    const indexer = new Indexer(db, embedder, 500, {
      docsMatcher,
      codeMatcher,
      pathGuard: guard,
      logger: { debug: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined },
    });
    const docs = await indexer.scanDocs();
    const code = await indexer.scanCode();
    console.log(`corpus ${REF}: ${String(docs.indexed)} docs, ${String(code.indexed)} code files, ${String(db.getDocumentCount())} indexed, dim ${String(DIM)}`);

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
        const results = countResults(text);
        const est = Math.ceil(text.length / 4);
        tokens.push(est);
        if (results === 0) empties++;
        console.log(`${query.slice(0, 50).padEnd(50)} ${String(text.length).padStart(7)} ${String(est).padStart(7)} ${String(results).padStart(8)} ${results === 0 ? 'yes' : ''}`);
      }
      const mean = tokens.reduce((a, b) => a + b, 0) / tokens.length;
      console.log(`SUMMARY mode=${mode} mean_tokens=${mean.toFixed(0)} p90_tokens=${String(percentile90(tokens))} empty=${String(empties)}/${String(QUERIES.length)}`);
    }
    indexer.close();
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
