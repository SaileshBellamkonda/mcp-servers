/**
 * Shared helpers for the network-free search benchmark and the retrieval eval: a pinned snapshot of this repository
 * indexed with a deterministic bag-of-hashed-tokens embedder (no embedding API involved).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Embedder } from '../../src/embedder/embedder.ts';
import { VectorDB } from '../../src/vectordb/db.ts';
import { Indexer } from '../../src/indexer/indexer.ts';
import { GlobMatcher } from '../../src/core/glob-utils.ts';
import { PathGuard } from '../../src/core/path-guard.ts';

export const DEFAULT_REF = 'bdb73d5';
export const DEFAULT_DIM = 768;
export const CORPUS_PATHS = ['packages/server-coderag/src', 'packages/shared', 'packages/server-coderag/README.md', 'docs'];

/** FNV-1a, 32 bit. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Deterministic embedding: hashed lowercase word pieces (camelCase and snake_case split) into `dim` buckets. */
export function hashEmbedding(text: string, dim: number): number[] {
  const vec = new Array<number>(dim).fill(0);
  const words = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    const h = fnv1a(word);
    vec[h % dim] = (vec[h % dim] ?? 0) + ((h >>> 16) % 2 === 0 ? 1 : -1);
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function makeFakeFetch(dim: number): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string | undefined) ?? '{}') as { input: string[] };
    const data = body.input.map((text, index) => ({ index, embedding: hashEmbedding(text, dim) }));
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }) as unknown as typeof fetch;
}

export interface PinnedCorpus {
  root: string;
  db: VectorDB;
  embedder: Embedder;
  indexer: Indexer;
  guard: PathGuard;
  docsIndexed: number;
  codeIndexed: number;
  dispose: () => void;
}

/** True when `ref` resolves to a commit in the repository (false in a shallow clone that lacks it). */
export function refIsAvailable(ref: string = DEFAULT_REF): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: repoRoot(), stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

/** Extracts the pinned snapshot into a temp directory and indexes it into an in-memory database. */
export async function indexPinnedCorpus(ref: string = DEFAULT_REF, dim: number = DEFAULT_DIM): Promise<PinnedCorpus> {
  const root = mkdtempSync(path.join(process.env['BENCH_TMP'] ?? tmpdir(), 'coderag-bench-'));
  const dispose = (): void => {
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const archive = execFileSync('git', ['archive', ref, ...CORPUS_PATHS], { cwd: repoRoot(), maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', root], { input: archive });

    const embedder = new Embedder({ url: 'http://bench.invalid/v1', model: 'hash', batchSize: 64 }, makeFakeFetch(dim));
    const db = VectorDB.open(':memory:', dim);
    const guard = new PathGuard([root]);
    const quiet = { warn: () => undefined, pathGuard: guard };
    const indexer = new Indexer(db, embedder, 500, {
      docsMatcher: new GlobMatcher(['**/*.md'], [], root, false, quiet),
      codeMatcher: new GlobMatcher(['**/*.ts'], [], root, false, quiet),
      pathGuard: guard,
      logger: { debug: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined },
    });
    const docs = await indexer.scanDocs();
    const code = await indexer.scanCode();
    return {
      root,
      db,
      embedder,
      indexer,
      guard,
      docsIndexed: docs.indexed,
      codeIndexed: code.indexed,
      dispose: () => {
        indexer.close();
        db.close();
        dispose();
      },
    };
  } catch (err) {
    dispose();
    throw err;
  }
}
