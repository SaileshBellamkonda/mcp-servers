import type { McpServer } from '@modelcontextprotocol/server';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import type { Indexer } from '../indexer/indexer.js';
import type { McpLogger } from '../core/logger.js';
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

export function createCodeRagServer(
  server: McpServer,
  db: VectorDB,
  embedder: Embedder,
  indexer: Indexer,
  defaultTopK: number,
  documentsDir: string,
  logger?: McpLogger,
): void {
  registerSearch(server, db, embedder, defaultTopK);
  registerIndexMarkdown(server, indexer);
  registerListDocuments(server, db);
  registerDeleteDocument(server, db);
  registerReindexDocument(server, db, indexer);
  registerAddFrontmatter(server);
  registerUpdateFrontmatter(server);
  registerIndexCode(server, indexer);
  registerSearchRelations(server, db);
  registerSyncDocuments(server, db, indexer, documentsDir, logger);
}
