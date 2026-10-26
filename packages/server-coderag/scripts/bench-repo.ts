/**
 * Indexes a real repository checkout with the code indexer (deterministic hashed-token embedder, no network) and reports
 * what the index looks like for that language: files, parse problems, chunks, symbols, relations, time, size, retrieval
 * quality against a labelled query file and the size of `search` answers. The repository is only read, never executed.
 *
 * Run: `pnpm --filter @mcp-servers/server-coderag run bench:repo -- --repo <dir> --lang <language> --include 'src/**\/*.py,tests/**\/*.py'`
 * (or `--queries scripts/bench-data/<lang>.json`, which also carries the include globs). Not part of the test run.
 * Options: --db <file> (default: temporary), --seed <n> (relation sample), --dim <n>, --sample-out <json> (writes the
 * seeded sample of calls/imports/inherits rows with their source lines, for checking them by hand).
 *
 * The hybrid rows only measure the keyword (FTS5) leg in practice: the hashed bag-of-words embedder is not semantic.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { Embedder } from '../src/embedder/embedder.js';
import { VectorDB } from '../src/vectordb/db.js';
import { openSqliteDatabase } from '../src/vectordb/sqlite-db.js';
import { Indexer } from '../src/indexer/indexer.js';
import { CodeParser } from '../src/indexer/code-parser.js';
import { getLanguageByExtension, isSupportedExtension } from '../src/indexer/languages.js';
import { GlobMatcher } from '../src/core/glob-utils.js';
import { PathGuard } from '../src/core/path-guard.js';
import { SyncManager } from '../src/indexer/sync-manager.js';
import { createCodeRagServer } from '../src/server/coderag-server.js';
import { makeFakeFetch } from './lib/corpus.js';
import { EVAL_FETCH, evaluate, formatSummary } from './lib/retrieval-eval.js';
import { hasKnownEdge, parseArgs, sampleSeeded, toLabelled, visibleRelations, VISIBLE_SQL, type RepoQueryFile } from './lib/repo-bench.js';

const args = parseArgs(process.argv.slice(2));
const repo = path.resolve(args.repo);
if (!existsSync(repo)) throw new Error(`Not a directory: ${repo}`);
const queryFile: RepoQueryFile | undefined = args.queries ? (JSON.parse(readFileSync(args.queries, 'utf8')) as RepoQueryFile) : undefined;
const include = args.include.length > 0 ? args.include : (queryFile?.include ?? ['**/*']);

// Grammar-load failures are written to stderr by the parser; collect them instead of letting them scroll by.
const stderrLines: string[] = [];
const realWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array): boolean => {
  stderrLines.push(String(chunk).trimEnd());
  return true;
}) as typeof process.stderr.write;

const tmp = mkdtempSync(path.join(process.env['BENCH_TMP'] ?? tmpdir(), 'coderag-repo-'));
const dbPath = args.db ?? path.join(tmp, 'index.db');
mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
rmSync(dbPath, { force: true });
const out = (line = ''): void => { console.log(line); };

const guard = new PathGuard([repo]);
const warnings: string[] = [];
const logger = { debug: () => undefined, info: () => undefined, warning: (m: string) => { warnings.push(m); }, error: (m: string) => { warnings.push(m); } };
const embedder = new Embedder({ url: 'http://bench.invalid/v1', model: 'hash', batchSize: 64 }, makeFakeFetch(args.dim));
const db = VectorDB.open(dbPath, args.dim);
const codeMatcher = new GlobMatcher(include, [], repo, false, { pathGuard: guard, warn: (m) => { warnings.push(m); } });
const indexer = new Indexer(db, embedder, 500, { codeMatcher, pathGuard: guard, logger });

try {
  const files = codeMatcher.findFiles().filter((f) => isSupportedExtension(path.extname(f).toLowerCase()));
  const sourceBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);

  const started = performance.now();
  const result = await indexer.scanCode(true);
  const indexSeconds = (performance.now() - started) / 1000;
  const peakRssMb = process.resourceUsage().maxRSS / 1024;

  // Per-file parse pass: errors, tree-sitter syntax errors and the slowest file.
  const parser = new CodeParser();
  const parseFailures: string[] = [];
  const syntaxErrorFiles: string[] = [];
  let slowest = { file: '', ms: 0 };
  // Text sent to the embedder: total, and what the doc comments of functions and methods contribute to it.
  let embedChars = 0;
  let docChars = 0;
  let docChunks = 0;
  let functionChunks = 0;
  const parsers = (parser as unknown as { parsers: Map<string, { parse(s: string): { rootNode: { hasError: boolean } } }> }).parsers;
  for (const file of files) {
    const t0 = performance.now();
    try {
      for (const chunk of parser.parseFileWithRelations(file).chunks) {
        embedChars += CodeParser.getEmbeddingText(chunk).length;
        if (chunk.symbolType === 'function' || chunk.symbolType === 'method') functionChunks++;
        if (chunk.doc) { docChars += chunk.doc.length + 1; docChunks++; }
      }
      const lang = getLanguageByExtension(path.extname(file).toLowerCase())?.name ?? '';
      if (parsers.get(lang)?.parse(readFileSync(file, 'utf8')).rootNode.hasError) syntaxErrorFiles.push(path.relative(repo, file));
    } catch (err) {
      parseFailures.push(`${path.relative(repo, file)}: ${String(err)}`);
    }
    const ms = performance.now() - t0;
    if (ms > slowest.ms) slowest = { file: path.relative(repo, file), ms };
  }

  indexer.close();
  db.close();
  const sizeBytes = statSync(dbPath).size + (existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0);

  // ── statistics straight from the written index ──────────────────────────────────────────────────────────────────
  const sql = openSqliteDatabase(dbPath, { readonly: true });
  const one = (query: string): number => sql.prepare<{ n: number | null }>(query).get()?.n ?? 0;
  const chunks = one("SELECT COUNT(*) AS n FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.doc_type = 'code'");
  const emptyFiles = one("SELECT COUNT(*) AS n FROM documents d WHERE d.doc_type = 'code' AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id)");
  const symbolKinds = sql.prepare<{ k: string; n: number }>('SELECT symbol_type AS k, COUNT(*) AS n FROM code_metadata GROUP BY symbol_type ORDER BY n DESC').all();
  const largest = sql.prepare<{ n: number; f: string; s: string }>(
    'SELECT length(c.content) AS n, d.filename AS f, COALESCE(m.symbol_name, \'\') AS s FROM chunks c JOIN documents d ON d.id = c.document_id LEFT JOIN code_metadata m ON m.chunk_id = c.id ORDER BY n DESC LIMIT 1',
  ).get();
  const totalChars = one('SELECT SUM(length(content)) AS n FROM chunks');

  // A skeleton is a class-like chunk whose stored text differs from the source lines it covers.
  let skeletons = 0;
  const containers = sql.prepare<{ f: string; s: number; e: number; c: string }>(
    "SELECT d.filename AS f, c.start_line AS s, c.end_line AS e, c.content AS c FROM chunks c JOIN documents d ON d.id = c.document_id JOIN code_metadata m ON m.chunk_id = c.id WHERE m.symbol_type IN ('class','struct','interface')",
  ).all();
  const lineCache = new Map<string, string[]>();
  for (const row of containers) {
    let lines = lineCache.get(row.f);
    if (!lines) { lines = readFileSync(row.f, 'utf8').split('\n'); lineCache.set(row.f, lines); }
    if (lines.slice(row.s - 1, row.e).join('\n').trim() !== row.c.trim()) skeletons++;
  }

  const relRows = sql.prepare<{ t: string; total: number; visible: number; resolved: number; ambiguous: number; hidden: number; fileResolved: number }>(
    `SELECT cr.relation_type AS t, COUNT(*) AS total, SUM(CASE WHEN ${VISIBLE_SQL} THEN 1 ELSE 0 END) AS visible,
            SUM(CASE WHEN cr.target_chunk_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN cr.target_chunk_id IS NULL AND cr.confidence = 0.5 THEN 1 ELSE 0 END) AS ambiguous,
            SUM(CASE WHEN cr.weak = 1 AND cr.target_chunk_id IS NULL AND cr.confidence != 0.5 THEN 1 ELSE 0 END) AS hidden,
            SUM(CASE WHEN cr.target_file IS NOT NULL AND cr.target_file != '' THEN 1 ELSE 0 END) AS fileResolved
     FROM code_relations cr GROUP BY cr.relation_type ORDER BY cr.relation_type`,
  ).all();
  const capped = one('SELECT COALESCE(SUM(dropped), 0) AS n FROM relation_caps');

  // ── report ─────────────────────────────────────────────────────────────────────────────────────────────────────
  out(`## ${args.lang}: ${queryFile?.repo ?? repo}@${(queryFile?.sha ?? '').slice(0, 10)}`);
  out(`include: ${include.join(', ')}`);
  out(`files seen=${String(files.length)} (${(sourceBytes / 1024).toFixed(0)} KB) indexed=${String(result.indexed)} skipped=${String(result.skipped)} failed=${String(result.failed)} no-symbol files=${String(emptyFiles)}`);
  out(`parse: failures=${String(parseFailures.length)} syntax-error files=${String(syntaxErrorFiles.length)} grammar/stderr lines=${String(stderrLines.length)} warnings=${String(warnings.length)} slowest=${slowest.file} ${slowest.ms.toFixed(0)} ms`);
  for (const line of [...parseFailures, ...stderrLines, ...warnings].slice(0, 15)) out(`  ! ${line}`);
  if (syntaxErrorFiles.length > 0) out(`  syntax-error files: ${syntaxErrorFiles.slice(0, 10).join(', ')}`);
  out(`chunks=${String(chunks)} skeleton chunks=${String(skeletons)} (of ${String(containers.length)} class-like) chunk chars total=${String(totalChars)} largest=${String(largest?.n ?? 0)} (${largest ? `${path.relative(repo, largest.f)}#${largest.s}` : '-'})`);
  out(`embedding text chars=${String(embedChars)} (without doc comments ${String(embedChars - docChars)}, +${((100 * docChars) / Math.max(1, embedChars - docChars)).toFixed(1)}%) functions/methods with a doc comment=${String(docChunks)}/${String(functionChunks)}`);
  out(`symbols: ${symbolKinds.map((r) => `${r.k}=${String(r.n)}`).join(' ')}`);
  for (const r of relRows) {
    out(`relations ${r.t.padEnd(8)} total=${String(r.total)} visible=${String(r.visible)} hidden-weak=${String(r.hidden)} resolved=${String(r.resolved)} ambiguous=${String(r.ambiguous)}${r.t === 'imports' ? ` file-resolved=${String(r.fileResolved)}` : ''}`);
  }
  out(`relations rows=${String(relRows.reduce((s, r) => s + r.total, 0))} capped(not recorded)=${String(capped)}`);
  out(`index time=${indexSeconds.toFixed(2)} s, DB size=${(sizeBytes / 1024 / 1024).toFixed(2)} MB, peak RSS=${peakRssMb.toFixed(0)} MB`);

  // ── retrieval quality and answer size ─────────────────────────────────────────────────────────────────────────
  const db2 = VectorDB.open(dbPath, args.dim);
  try {
    if (queryFile) {
      const labelled = toLabelled(queryFile);
      const keyword = await evaluate(labelled, (q) => db2.searchByKeyword(q, EVAL_FETCH, null));
      const hybrid = await evaluate(labelled, async (q) => db2.searchHybrid(await embedder.embed(q), q, EVAL_FETCH, null));
      const semantic = await evaluate(labelled, async (q) => db2.searchWithFilter(await embedder.embed(q), EVAL_FETCH, null));
      out(`queries=${String(labelled.length)}`);
      out(formatSummary('keyword', keyword));
      out(formatSummary('hybrid', hybrid));
      out(formatSummary('semantic', semantic));
      for (const [i, o] of keyword.outcomes.entries()) {
        out(`  ${o.kind.padEnd(14)} kw=${String(o.rank ?? '-').padStart(2)} hy=${String(hybrid.outcomes[i]?.rank ?? '-').padStart(2)} sem=${String(semantic.outcomes[i]?.rank ?? '-').padStart(2)}  ${o.query}`);
      }

      const server = new McpServer({ name: 'bench', version: '0.0.0' }, { capabilities: { tools: {} } });
      const indexer2 = new Indexer(db2, embedder, 500, { pathGuard: guard, logger });
      createCodeRagServer(server, db2, embedder, indexer2, 5, [repo], new SyncManager(), undefined, ':memory:', 'hash', guard);
      const search = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools['search']?.handler;
      if (search) {
        for (const mode of ['hybrid', 'keyword'] as const) {
          const tokens: number[] = [];
          for (const q of labelled) tokens.push(Math.ceil(((await search({ query: q.query, mode })).content[0]?.text ?? '').length / 4));
          out(`search tokens ${mode}: mean=${(tokens.reduce((a, b) => a + b, 0) / tokens.length).toFixed(0)} max=${String(Math.max(...tokens))} (n=${String(tokens.length)})`);
        }
      }
      indexer2.close();

      if (queryFile.knownEdges && queryFile.knownEdges.length > 0) {
        const check = openSqliteDatabase(dbPath, { readonly: true });
        const missed = queryFile.knownEdges.filter((e) => !hasKnownEdge(check, e));
        out(`known edges found=${String(queryFile.knownEdges.length - missed.length)}/${String(queryFile.knownEdges.length)}`);
        for (const e of missed) out(`  missed ${e.type} ${e.file} ${e.symbol} -> ${e.target}`);
        check.close();
      }
    }
  } finally {
    db2.close();
  }

  // ── seeded relation sample for hand verification ───────────────────────────────────────────────────────────────
  if (args.sampleOut) {
    const lineAt = (file: string, line: number): string => {
      let lines = lineCache.get(file);
      if (!lines) { lines = readFileSync(file, 'utf8').split('\n'); lineCache.set(file, lines); }
      return (lines[line - 1] ?? '').trim().slice(0, 200);
    };
    const sample = [
      ...sampleSeeded(visibleRelations(sql, 'calls'), 20, args.seed),
      ...sampleSeeded(visibleRelations(sql, 'imports'), 10, args.seed),
      ...sampleSeeded(visibleRelations(sql, 'inherits'), 15, args.seed),
    ].map((r) => ({ ...r, sourceFile: path.relative(repo, r.sourceFile), resolvedTo: r.resolvedTo.replace(`${repo}/`, ''), text: lineAt(path.join(repo, path.relative(repo, r.sourceFile)), r.line) }));
    writeFileSync(args.sampleOut, JSON.stringify(sample, null, 1));
    out(`sample written: ${args.sampleOut} (${String(sample.length)} rows, seed ${String(args.seed)})`);
  }
  sql.close();
} finally {
  process.stderr.write = realWrite;
  if (!args.db) rmSync(tmp, { recursive: true, force: true });
}
