/**
 * Labelled retrieval queries over the pinned snapshot (see corpus.ts, ref bdb73d5). Every target was verified by
 * reading the snapshot. A query lists the acceptable targets; a result is relevant when it matches any of them.
 */
export interface Target {
  /** Path suffix of the indexed file, e.g. `vectordb/db.ts`. */
  file: string;
  /** Optional symbol: matches a code hit whose symbol name, or whose parent symbol, equals it. */
  symbol?: string;
}

export type QueryKind = 'natural' | 'identifier' | 'camel-fragment' | 'snake-kebab' | 'concept' | 'docs';

export interface LabelledQuery {
  query: string;
  kind: QueryKind;
  expect: Target[];
}

const SRC = 'server-coderag/src/';
const HTTP = 'shared/http-host/src/';
const DESIGN = 'docs/DESIGN.md';
const SPEC = 'docs/specs/2026-05-01-typescript-best-practices.md';
const README = 'server-coderag/README.md';

export const LABELLED_QUERIES: readonly LabelledQuery[] = [
  // natural language
  { query: 'how are embeddings requested from the API', kind: 'natural', expect: [{ file: `${SRC}embedder/embedder.ts` }] },
  { query: 'where are file paths checked against the allowed roots', kind: 'natural', expect: [{ file: `${SRC}core/path-guard.ts`, symbol: 'PathGuard' }] },
  { query: 'how does the server split markdown into chunks by heading', kind: 'natural', expect: [{ file: `${SRC}indexer/chunk.ts` }, { file: `${SRC}indexer/loaders/markdown.ts` }] },
  { query: 'how are vector and keyword search results merged', kind: 'natural', expect: [{ file: `${SRC}vectordb/db.ts`, symbol: 'searchHybrid' }] },
  { query: 'what happens when the embedding dimensions of an existing database differ', kind: 'natural', expect: [{ file: `${SRC}vectordb/db.ts`, symbol: 'open' }, { file: `${SRC}core/dimensions.ts` }] },
  { query: 'how is the bearer token compared in constant time', kind: 'natural', expect: [{ file: `${HTTP}security.ts` }] },
  { query: 'how do we detect loopback addresses', kind: 'natural', expect: [{ file: `${HTTP}loopback.ts` }, { file: `${SRC}core/config.ts`, symbol: 'isLoopbackHost' }] },
  { query: 'limit the size of the request body', kind: 'natural', expect: [{ file: `${HTTP}guards.ts`, symbol: 'bodyLimit' }] },
  { query: 'reject browser requests from foreign origins', kind: 'natural', expect: [{ file: `${HTTP}guards.ts` }] },
  { query: 'remove the api key from error messages', kind: 'natural', expect: [{ file: `${SRC}embedder/embedder.ts`, symbol: 'sanitizeErrorBody' }] },
  { query: 'watch the include directories and reindex changed files', kind: 'natural', expect: [{ file: `${SRC}indexer/watcher.ts` }] },
  { query: 'prevent two syncs from running at the same time', kind: 'natural', expect: [{ file: `${SRC}indexer/sync-manager.ts` }] },
  { query: 'check whether the runtime supports node sqlite', kind: 'natural', expect: [{ file: `${SRC}vectordb/sqlite-probe.ts` }] },
  { query: 'when does the startup sync rescan everything', kind: 'natural', expect: [{ file: `${SRC}indexer/sync.ts`, symbol: 'runStartupSync' }] },

  // identifiers
  { query: 'PathGuard', kind: 'identifier', expect: [{ file: `${SRC}core/path-guard.ts`, symbol: 'PathGuard' }] },
  { query: 'extractSignature', kind: 'identifier', expect: [{ file: `${SRC}indexer/code-parser.ts`, symbol: 'extractSignature' }] },
  { query: 'searchHybrid', kind: 'identifier', expect: [{ file: `${SRC}vectordb/db.ts`, symbol: 'searchHybrid' }] },
  { query: 'startMcpHttpServer', kind: 'identifier', expect: [{ file: `${HTTP}server.ts`, symbol: 'startMcpHttpServer' }] },
  { query: 'resolveDimensions', kind: 'identifier', expect: [{ file: `${SRC}core/dimensions.ts`, symbol: 'resolveDimensions' }] },
  { query: 'loadSqliteVec', kind: 'identifier', expect: [{ file: `${SRC}vectordb/sqlite-db.ts`, symbol: 'loadSqliteVec' }] },
  { query: 'assertSecureEmbeddingUrl', kind: 'identifier', expect: [{ file: `${SRC}core/config.ts`, symbol: 'assertSecureEmbeddingUrl' }] },

  // camelCase fragments of identifiers
  { query: 'chunk markdown', kind: 'camel-fragment', expect: [{ file: `${SRC}indexer/chunk.ts` }, { file: `${SRC}indexer/loaders/markdown.ts` }] },
  { query: 'frontmatter size limit', kind: 'camel-fragment', expect: [{ file: `${SRC}indexer/loaders/markdown.ts` }] },
  { query: 'glob matcher', kind: 'camel-fragment', expect: [{ file: `${SRC}core/glob-utils.ts`, symbol: 'GlobMatcher' }] },
  { query: 'sync in progress', kind: 'camel-fragment', expect: [{ file: `${SRC}indexer/sync-manager.ts` }] },
  { query: 'tokens equal', kind: 'camel-fragment', expect: [{ file: `${HTTP}security.ts`, symbol: 'tokensEqual' }] },
  { query: 'init languages', kind: 'camel-fragment', expect: [{ file: `${SRC}indexer/code-parser.ts`, symbol: 'initLanguages' }] },
  { query: 'secure embedding url', kind: 'camel-fragment', expect: [{ file: `${SRC}core/config.ts`, symbol: 'assertSecureEmbeddingUrl' }] },

  // snake_case, kebab-case and environment variable names
  { query: 'doc_tags', kind: 'snake-kebab', expect: [{ file: `${SRC}vectordb/db.ts` }, { file: `${SRC}vectordb/schema.ts` }] },
  { query: 'chunk_size', kind: 'snake-kebab', expect: [{ file: `${SRC}vectordb/schema.ts` }, { file: README }] },
  { query: 'last_docs_sync_at', kind: 'snake-kebab', expect: [{ file: `${SRC}vectordb/db.ts` }, { file: `${SRC}tools/index-status.ts` }] },
  { query: 'docs_reindex_required', kind: 'snake-kebab', expect: [{ file: `${SRC}vectordb/db.ts` }] },
  { query: 'MCP_AUTH_TOKEN', kind: 'snake-kebab', expect: [{ file: `${HTTP}security.ts` }, { file: `${HTTP}server.ts` }, { file: README }, { file: 'shared/http-host/README.md' }] },
  { query: 'node-gyp-build', kind: 'snake-kebab', expect: [{ file: `${SRC}indexer/code-parser.ts` }] },
  { query: 'tree-sitter grammar', kind: 'snake-kebab', expect: [{ file: `${SRC}indexer/code-parser.ts` }] },

  // multi-word concepts
  { query: 'reciprocal rank fusion', kind: 'concept', expect: [{ file: `${SRC}vectordb/db.ts`, symbol: 'searchHybrid' }] },
  { query: 'debounce file change events', kind: 'concept', expect: [{ file: `${SRC}indexer/watcher.ts` }] },
  { query: 'merge tiny chunks', kind: 'concept', expect: [{ file: `${SRC}indexer/chunk.ts`, symbol: 'mergeTinyChunks' }] },
  { query: 'symlink escape outside roots', kind: 'concept', expect: [{ file: `${SRC}core/path-guard.ts` }, { file: `${SRC}core/glob-utils.ts` }] },
  { query: 'graceful shutdown closing sessions', kind: 'concept', expect: [{ file: `${HTTP}server.ts` }] },
  { query: 'idle session timeout', kind: 'concept', expect: [{ file: `${HTTP}server.ts` }] },
  { query: 'maximum concurrent sessions', kind: 'concept', expect: [{ file: `${HTTP}server.ts` }] },

  // documentation and markdown
  { query: 'how to run the server over HTTP', kind: 'docs', expect: [{ file: README }] },
  { query: 'which environment variable sets the default number of search results', kind: 'docs', expect: [{ file: README }] },
  { query: 'technology stack of the monorepo', kind: 'docs', expect: [{ file: DESIGN }] },
  { query: 'acceptance criteria', kind: 'docs', expect: [{ file: SPEC }] },
  { query: 'pnpm catalog', kind: 'docs', expect: [{ file: SPEC }] },
  { query: 'where is the index stored on disk', kind: 'docs', expect: [{ file: README }, { file: DESIGN }] },
  { query: 'dependency graph of the packages', kind: 'docs', expect: [{ file: DESIGN }] },
  { query: 'test pyramid', kind: 'docs', expect: [{ file: DESIGN }] },
  { query: 'http-host testing subpath', kind: 'docs', expect: [{ file: 'shared/http-host/README.md' }] },
  { query: 'path confinement security', kind: 'docs', expect: [{ file: README }, { file: DESIGN }, { file: `${SRC}core/path-guard.ts` }] },
];
