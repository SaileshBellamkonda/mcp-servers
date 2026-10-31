import type { McpServer } from '@modelcontextprotocol/server';
import type { VectorDB } from '../vectordb/db.ts';
import type { Embedder } from '../embedder/embedder.ts';
import type { Indexer } from '../indexer/indexer.ts';
import type { CodeRagLogger } from '../core/logger.ts';
import type { SyncManager } from '../indexer/sync-manager.ts';
import { PathGuard } from '../core/path-guard.ts';
import { DEFAULT_TOOLSET, isToolEnabled, type Toolset } from '../core/toolset.ts';
import type { SearchFreshness } from '../tools/search-freshness.ts';
import { registerSearch } from '../tools/search.ts';
import { registerIndexMarkdown } from '../tools/index-markdown.ts';
import { registerListDocuments } from '../tools/list-documents.ts';
import { registerDeleteDocument } from '../tools/delete-document.ts';
import { registerReindexDocument } from '../tools/reindex-document.ts';
import { registerAddFrontmatter } from '../tools/add-frontmatter.ts';
import { registerUpdateFrontmatter } from '../tools/update-frontmatter.ts';
import { registerIndexCode } from '../tools/index-code.ts';
import { registerSearchRelations } from '../tools/search-relations.ts';
import { registerSyncDocuments } from '../tools/sync-documents.ts';
import { registerIndexStatus } from '../tools/index-status.ts';

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
