import type { McpServer } from '@modelcontextprotocol/server';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import type { Indexer } from '../indexer/indexer.js';
import type { CodeRagLogger } from '../core/logger.js';
import type { SyncManager } from '../indexer/sync-manager.js';
import { PathGuard } from '../core/path-guard.js';
import { DEFAULT_TOOLSET, isToolEnabled, type Toolset } from '../core/toolset.js';
import type { SearchFreshness } from '../tools/search-freshness.js';
import { registerSearch } from '../tools/search.js';
import { registerIndexMarkdown } from '../tools/index-markdown.js';
import { registerListDocuments } from '../tools/list-documents.js';
import { registerDeleteDocument } from '../tools/delete-document.js';
import { registerReindexDocument } from '../tools/reindex-document.js';
import { registerAddFrontmatter } from '../tools/add-frontmatter.js';
import { registerUpdateFrontmatter } from '../tools/update-frontmatter.js';
import { registerIndexCode } from '../tools/index-code.js';
import { registerSearchRelations } from '../tools/search-relations.js';
import { registerSyncDocuments } from '../tools/sync-documents.js';
import { registerIndexStatus } from '../tools/index-status.js';

export interface CodeRagServerOptions {
  /** Which tools to register (default: `standard`). */
  toolset?: Toolset;
  /** Lets `search` leave out hits of deleted files, flag changed ones and refresh them in the background. */
  freshness?: SearchFreshness;
}

export function createCodeRagServer(
  server: McpServer,
  db: VectorDB,
  embedder: Embedder,
  indexer: Indexer,
  defaultTopK: number,
  includeDirs: string[],
  syncManager: SyncManager,
  logger?: CodeRagLogger,
  dbPath?: string,
  embeddingModel?: string,
  pathGuard: PathGuard = new PathGuard([process.cwd()]),
  options: CodeRagServerOptions = {},
): void {
  const toolset = options.toolset ?? DEFAULT_TOOLSET;
  const on = (name: string): boolean => isToolEnabled(toolset, name);
  if (on('search')) registerSearch(server, db, embedder, defaultTopK, pathGuard, options.freshness);
  if (on('index_markdown')) registerIndexMarkdown(server, indexer, syncManager, pathGuard);
  if (on('list_documents')) registerListDocuments(server, db);
  if (on('delete_document')) registerDeleteDocument(server, db, syncManager, pathGuard);
  if (on('reindex_document')) registerReindexDocument(server, db, indexer, syncManager, pathGuard);
  if (on('add_frontmatter')) registerAddFrontmatter(server, pathGuard);
  if (on('update_frontmatter')) registerUpdateFrontmatter(server, pathGuard);
  if (on('index_code')) registerIndexCode(server, indexer, syncManager, pathGuard);
  if (on('search_relations')) registerSearchRelations(server, db, pathGuard);
  if (on('sync_documents')) registerSyncDocuments(server, db, indexer, includeDirs, syncManager, pathGuard, logger);
  if (on('get_index_status')) registerIndexStatus(server, db, { model: embeddingModel ?? 'unknown' }, syncManager, dbPath ?? '');
}
