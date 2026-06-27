import type { McpServer } from '@modelcontextprotocol/server';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import type { Indexer } from '../indexer/indexer.js';
import type { McpLogger } from '../core/logger.js';
import type { SyncManager } from '../indexer/sync-manager.js';
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

export function createCodeRagServer(
  server: McpServer,
  db: VectorDB,
  embedder: Embedder,
  indexer: Indexer,
  defaultTopK: number,
  includeDirs: string[],
  syncManager: SyncManager,
  logger?: McpLogger,
  dbPath?: string,
  embeddingModel?: string,
): void {
  registerSearch(server, db, embedder, defaultTopK);
  registerIndexMarkdown(server, indexer, syncManager);
  registerListDocuments(server, db);
  registerDeleteDocument(server, db, syncManager);
  registerReindexDocument(server, db, indexer, syncManager);
  registerAddFrontmatter(server);
  registerUpdateFrontmatter(server);
  registerIndexCode(server, indexer, syncManager);
  registerSearchRelations(server, db);
  registerSyncDocuments(server, db, indexer, includeDirs, syncManager, logger);
  registerIndexStatus(server, db, { model: embeddingModel ?? 'unknown' }, syncManager, dbPath ?? '');
}
