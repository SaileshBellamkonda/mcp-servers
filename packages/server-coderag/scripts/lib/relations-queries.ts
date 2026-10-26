/**
 * Labelled relation questions over the pinned snapshot (see corpus.ts, ref bdb73d5). Every expected item was
 * established by grep on the snapshot (call sites, `from '...'` lines, `extends`/`implements` clauses) and checked by
 * reading the lines, not taken from the extractor's output.
 *
 * Item keys: callers and subclasses `last-two-path-segments:Symbol` (`tools/delete-document.ts:registerDeleteDocument`),
 * callees the callee name, imports the module specifier as written, importers the last two path segments.
 * Calls are counted where the extractor records them: inside a function, method or class, not in module-level
 * statements or in the callbacks of a test file's `describe`/`it`.
 */
export type RelationQuestionKind = 'callers' | 'callees' | 'imports' | 'importers' | 'inheritors';

export interface RelationQuestion {
  question: string;
  kind: RelationQuestionKind;
  /** Symbol or file path handed to `queryRelations`. */
  symbol: string;
  expect: string[];
}

export const RELATION_QUESTIONS: readonly RelationQuestion[] = [
  // who calls X
  { question: 'who calls deleteDocument', kind: 'callers', symbol: 'deleteDocument', expect: [
    'tools/reindex-document.ts:registerReindexDocument', 'tools/delete-document.ts:registerDeleteDocument', 'indexer/indexer.ts:indexFile',
    'indexer/sync.ts:syncDocuments', 'indexer/sync.ts:pruneExcluded', 'indexer/sync.ts:removeStaleDocs', 'indexer/sync.ts:removeStaleCode',
    'indexer/watcher.ts:handleChange'] },
  { question: 'who calls assertAllowed', kind: 'callers', symbol: 'assertAllowed', expect: [
    'tools/sync-documents.ts:registerSyncDocuments', 'tools/index-markdown.ts:indexSingleFile', 'tools/index-markdown.ts:registerIndexMarkdown',
    'tools/reindex-document.ts:registerReindexDocument', 'tools/delete-document.ts:registerDeleteDocument', 'tools/index-code.ts:indexSingleFile',
    'tools/index-code.ts:registerIndexCode', 'core/path-guard.ts:isAllowed'] },
  { question: 'who calls syncLockedResponse', kind: 'callers', symbol: 'syncLockedResponse', expect: [
    'tools/sync-documents.ts:registerSyncDocuments', 'tools/index-markdown.ts:registerIndexMarkdown', 'tools/reindex-document.ts:registerReindexDocument',
    'tools/delete-document.ts:registerDeleteDocument', 'tools/index-code.ts:registerIndexCode'] },
  { question: 'who calls matchFenceOpen', kind: 'callers', symbol: 'matchFenceOpen', expect: [
    'loaders/mdx.ts:stripMdx', 'loaders/markdown.ts:isSetextCandidate', 'loaders/markdown.ts:parseMarkdownBody', 'indexer/chunk.ts:toBlocks',
    'indexer/chunk.ts:splitBlock'] },
  { question: 'who calls jsonRpcError', kind: 'callers', symbol: 'jsonRpcError', expect: [
    'src/server.ts:startMcpHttpServer', 'src/server.ts:unknownSession', 'src/guards.ts:originGuard', 'src/guards.ts:jsonContentType', 'src/guards.ts:tooLarge'] },
  { question: 'who calls isSupportedExtension', kind: 'callers', symbol: 'isSupportedExtension', expect: [
    'tools/reindex-document.ts:registerReindexDocument', 'indexer/indexer.ts:scanCode', 'indexer/indexer.ts:indexCodeDirectory', 'indexer/watcher.ts:handleChange'] },
  { question: 'who calls assertAllowedReal', kind: 'callers', symbol: 'assertAllowedReal', expect: [
    'tools/update-frontmatter.ts:registerUpdateFrontmatter', 'tools/add-frontmatter.ts:registerAddFrontmatter', 'indexer/indexer.ts:indexFile',
    'indexer/indexer.ts:indexCodeFile'] },
  { question: 'who calls parseFrontmatter', kind: 'callers', symbol: 'parseFrontmatter', expect: [
    'tools/update-frontmatter.ts:registerUpdateFrontmatter', 'tools/add-frontmatter.ts:registerAddFrontmatter', 'loaders/markdown.ts:splitFrontmatter'] },
  { question: 'who calls indexCodeFile', kind: 'callers', symbol: 'indexCodeFile', expect: [
    'tools/reindex-document.ts:registerReindexDocument', 'tools/index-code.ts:indexSingleFile', 'indexer/indexer.ts:indexFileList', 'indexer/watcher.ts:handleChange'] },
  { question: 'who calls indexFile', kind: 'callers', symbol: 'indexFile', expect: [
    'tools/index-markdown.ts:indexSingleFile', 'tools/reindex-document.ts:registerReindexDocument', 'indexer/indexer.ts:indexFileList', 'indexer/watcher.ts:handleChange'] },
  { question: 'who calls startMcpHttpServer', kind: 'callers', symbol: 'startMcpHttpServer', expect: [
    'testing/index.ts:startTestServer', 'src/embedded.ts:activateCodeRagServer', 'src/standalone.ts:main'] },
  { question: 'who calls resolveDimensions', kind: 'callers', symbol: 'resolveDimensions', expect: ['src/embedded.ts:activateCodeRagServer', 'src/standalone.ts:main'] },
  { question: 'who calls isLoopbackHost (two functions of that name)', kind: 'callers', symbol: 'isLoopbackHost', expect: [
    'src/server.ts:hostHeaderConfig', 'src/security.ts:assertSafeBinding', 'src/guards.ts:isAllowedOrigin', 'core/config.ts:assertSecureEmbeddingUrl'] },
  { question: 'who calls runStartupSync', kind: 'callers', symbol: 'runStartupSync', expect: ['src/embedded.ts:activateCodeRagServer', 'src/standalone.ts:scheduleStartupSync'] },
  { question: 'who calls embedBatch', kind: 'callers', symbol: 'embedBatch', expect: [
    'embedder/embedder.ts:embed', 'embedder/embedder.ts:detectDimensions', 'indexer/indexer.ts:indexFile', 'indexer/indexer.ts:indexCodeFile'] },
  { question: 'who calls run (a very common method name)', kind: 'callers', symbol: 'run', expect: [
    'tools/sync-documents.ts:registerSyncDocuments', 'vectordb/sqlite-probe.ts:probeSqliteSupport', 'vectordb/sqlite-db.ts:run', 'vectordb/db.ts:runMigrations',
    'vectordb/db.ts:open', 'vectordb/db.ts:requireDocsReindex', 'vectordb/db.ts:clearDocsReindexRequired', 'vectordb/db.ts:deleteDocument',
    'vectordb/db.ts:insertDocument', 'vectordb/db.ts:insertCodeDocument', 'vectordb/db.ts:insertRelations', 'vectordb/db.ts:saveRules',
    'vectordb/db.ts:setLastSyncAt', 'indexer/sync.ts:runStartupSync'] },

  // calls to common names (stop-listed as noise unless the index has a symbol of that name)
  { question: 'who calls log (a common name, defined three times)', kind: 'callers', symbol: 'log', expect: [
    'src/logger.ts:debug', 'src/logger.ts:info', 'src/logger.ts:notice', 'src/logger.ts:warning', 'src/logger.ts:error', 'src/logger.ts:critical',
    'indexer/indexer.ts:matcherOptions', 'indexer/indexer.ts:indexFile', 'indexer/indexer.ts:indexCodeFile', 'indexer/indexer.ts:indexFileList',
    'indexer/sync.ts:syncDocuments'] },
  { question: 'who calls emit (a local function)', kind: 'callers', symbol: 'emit', expect: ['indexer/chunk.ts:packLines', 'indexer/chunk.ts:chunkSections'] },
  { question: 'who calls close (a common name, defined six times)', kind: 'callers', symbol: 'close', expect: [
    'src/server.ts:touch', 'src/server.ts:discard', 'src/server.ts:createSession', 'src/server.ts:close', 'vectordb/sqlite-probe.ts:probeSqliteSupport',
    'vectordb/sqlite-db.ts:close', 'vectordb/db.ts:readStoredDimensions', 'vectordb/db.ts:open', 'vectordb/db.ts:close', 'src/embedded.ts:activateCodeRagServer',
    'src/embedded.ts:deactivateCodeRagServer', 'src/standalone.ts:main', 'src/standalone.ts:shutdown', 'indexer/indexer.ts:close', 'indexer/watcher.ts:close'] },

  // what does X call (functions and methods of this repository only)
  { question: 'what does runStartupSync call', kind: 'callees', symbol: 'runStartupSync', expect: [
    'getStoredRules', 'getDocumentCountByType', 'globConfigEqual', 'isDocsReindexRequired', 'GlobMatcher', 'pruneExcluded', 'scanDocs', 'setLastSyncAt',
    'clearDocsReindexRequired', 'scanCode', 'removeStaleDocs', 'removeStaleCode', 'saveRules', 'run', 'info'] },
  { question: 'what does indexCodeFile call', kind: 'callees', symbol: 'indexCodeFile', expect: [
    'assertAllowedReal', 'log', 'getCodeParser', 'parseFile', 'getEmbeddingText', 'embedBatch', 'insertCodeDocument'] },
  { question: 'what does registerDeleteDocument call', kind: 'callees', symbol: 'registerDeleteDocument', expect: ['syncLockedResponse', 'assertAllowed', 'deleteDocument'] },
  { question: 'what does PathGuard.check call', kind: 'callees', symbol: 'PathGuard.check', expect: ['resolveReal', 'isPathWithin', 'PathNotAllowedError'] },

  // what does file Y import
  { question: 'what does core/path-guard.ts import', kind: 'imports', symbol: 'server-coderag/src/core/path-guard.ts', expect: ['node:fs', 'node:path', './types.js', './glob-utils.js'] },
  { question: 'what does indexer/sync.ts import', kind: 'imports', symbol: 'server-coderag/src/indexer/sync.ts', expect: [
    'node:fs', '../vectordb/db.js', './indexer.js', '../core/logger.js', '../core/types.js', '../core/glob-utils.js', './sync-manager.js'] },
  { question: 'what does tools/delete-document.ts import', kind: 'imports', symbol: 'server-coderag/src/tools/delete-document.ts', expect: [
    '@modelcontextprotocol/server', 'zod', '../vectordb/db.js', '../indexer/sync-manager.js', '../core/path-guard.js'] },
  { question: 'what does http-host/src/server.ts import', kind: 'imports', symbol: 'shared/http-host/src/server.ts', expect: [
    'node:crypto', 'node:net', 'node:http', '@hono/node-server', '@modelcontextprotocol/hono', '@modelcontextprotocol/server', 'hono', './loopback.js', './guards.js', './security.js'] },

  // who imports file Z
  { question: 'who imports core/path-guard.ts', kind: 'importers', symbol: 'server-coderag/src/core/path-guard.ts', expect: [
    'core/glob-utils.ts', 'src/embedded.ts', 'indexer/indexer.ts', 'server/coderag-server.ts', 'src/standalone.ts', 'tools/add-frontmatter.ts', 'tools/delete-document.ts',
    'tools/index-code.ts', 'tools/index-markdown.ts', 'tools/reindex-document.ts', 'tools/sync-documents.ts', 'tools/update-frontmatter.ts'] },
  { question: 'who imports indexer/sync-manager.ts', kind: 'importers', symbol: 'server-coderag/src/indexer/sync-manager.ts', expect: [
    'src/embedded.ts', 'indexer/sync.ts', 'indexer/watcher.ts', 'server/coderag-server.ts', 'src/standalone.ts', 'tools/delete-document.ts', 'tools/index-code.ts',
    'tools/index-markdown.ts', 'tools/index-status.ts', 'tools/reindex-document.ts', 'tools/sync-documents.ts'] },
  { question: 'who imports loaders/fence.ts', kind: 'importers', symbol: 'server-coderag/src/indexer/loaders/fence.ts', expect: ['indexer/chunk.ts', 'loaders/markdown.ts', 'loaders/mdx.ts'] },
  { question: 'who imports vectordb/sqlite-db.ts', kind: 'importers', symbol: 'server-coderag/src/vectordb/sqlite-db.ts', expect: ['vectordb/db.ts', 'vectordb/sqlite-probe.ts'] },

  // who extends or implements X
  { question: 'which classes extend Error', kind: 'inheritors', symbol: 'Error', expect: [
    'src/security.ts:HttpSecurityError', 'core/path-guard.ts:PathNotAllowedError', 'core/types.ts:ConfigError', 'indexer/sync-manager.ts:SyncInProgressError',
    'loaders/markdown.ts:FrontmatterTooLargeError'] },
  { question: 'which classes implement DocumentLoader', kind: 'inheritors', symbol: 'DocumentLoader', expect: ['loaders/mdx.ts:MdxLoader', 'loaders/markdown.ts:MarkdownLoader'] },
  { question: 'what extends McpHttpServer', kind: 'inheritors', symbol: 'McpHttpServer', expect: ['testing/index.ts:TestServer'] },
  { question: 'what extends RpcResponse', kind: 'inheritors', symbol: 'RpcResponse', expect: ['testing/index.ts:InitializedSession'] },
];

export interface VerifiedCall {
  /** Path suffix of the file and 1-based line of the call. */
  at: string;
  /** The enclosing symbol as `Parent.name` or `name`. */
  inside: string;
  /** The callee as written. */
  callee: string;
  /** `file:line` of the symbol the edge should resolve to; absent when the callee is not defined in the snapshot. */
  resolvedTo?: string;
}

/**
 * 20 `calls` edges drawn at random (seeded shuffle of all 603 edges of the snapshot) and checked by hand against the
 * source: every call exists at that line inside that symbol, and every resolved target is the function or method the
 * call really refers to (`this.db.prepare(...)` on a `SqliteDatabase` is `SqliteDatabase.prepare`).
 */
export const VERIFIED_CALL_SAMPLE: readonly VerifiedCall[] = [
  { at: 'shared/http-host/src/guards.ts:57', inside: 'jsonContentType', callee: 'Headers' },
  { at: 'server-coderag/src/core/glob-utils.ts:115', inside: 'realOrNull', callee: 'native' },
  { at: 'server-coderag/src/vectordb/sqlite-db.ts:98', inside: 'bind', callee: 'toSqlInput', resolvedTo: 'server-coderag/src/vectordb/sqlite-db.ts:70' },
  { at: 'server-coderag/src/vectordb/db.ts:398', inside: 'VectorDB.getLastSyncAt', callee: 'prepare', resolvedTo: 'server-coderag/src/vectordb/sqlite-db.ts:135' },
  { at: 'server-coderag/src/tools/search-relations.ts:16', inside: 'registerSearchRelations', callee: 'fromJsonSchema' },
  { at: 'server-coderag/src/indexer/loaders/mdx.ts:94', inside: 'stripMdx', callee: 'matchFenceOpen', resolvedTo: 'server-coderag/src/indexer/loaders/fence.ts:15' },
  { at: 'shared/http-host/src/guards.ts:93', inside: 'bodyLimit', callee: 'Request' },
  { at: 'server-coderag/src/vectordb/db.ts:142', inside: 'VectorDB.open', callee: 'loadSqliteVec', resolvedTo: 'server-coderag/src/vectordb/sqlite-db.ts:192' },
  { at: 'server-coderag/src/standalone.ts:72', inside: 'main', callee: 'parseBool', resolvedTo: 'shared/common/src/env.ts:43' },
  { at: 'shared/http-host/src/guards.ts:36', inside: 'originGuard', callee: 'isAllowedOrigin', resolvedTo: 'shared/http-host/src/guards.ts:11' },
  { at: 'server-coderag/src/vectordb/db.ts:657', inside: 'buildFilterConditions', callee: 'globToLike', resolvedTo: 'server-coderag/src/vectordb/db.ts:621' },
  { at: 'server-coderag/src/indexer/loaders/markdown.ts:98', inside: 'parseFrontmatter', callee: 'frontmatterBlockSize', resolvedTo: 'server-coderag/src/indexer/loaders/markdown.ts:83' },
  { at: 'server-coderag/src/tools/index-code.ts:26', inside: 'registerIndexCode', callee: 'fromJsonSchema' },
  { at: 'server-coderag/src/vectordb/db.ts:554', inside: 'VectorDB.searchHybrid', callee: 'semanticKey', resolvedTo: 'server-coderag/src/vectordb/db.ts:550' },
  { at: 'shared/http-host/tests/unit/limits.test.ts:174', inside: 'body', callee: 'repeat' },
  { at: 'shared/http-host/src/server.ts:205', inside: 'createSession', callee: 'touch', resolvedTo: 'shared/http-host/src/server.ts:141' },
  { at: 'server-coderag/src/standalone.ts:38', inside: 'main', callee: 'createStderrLogger', resolvedTo: 'server-coderag/src/core/logger.ts:18' },
  { at: 'server-coderag/src/vectordb/db.ts:35', inside: 'tableExists', callee: 'prepare', resolvedTo: 'server-coderag/src/vectordb/sqlite-db.ts:135' },
  { at: 'shared/http-host/tests/unit/origin.test.ts:13', inside: 'start', callee: 'startTestServer', resolvedTo: 'shared/http-host/src/testing/index.ts:18' },
  { at: 'server-coderag/src/indexer/sync.ts:122', inside: 'runStartupSync', callee: 'removeStaleCode', resolvedTo: 'server-coderag/src/indexer/sync.ts:157' },
];
