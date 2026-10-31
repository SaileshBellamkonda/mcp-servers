import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { VectorDB } from '../vectordb/db.ts';
import type { SyncManager } from '../indexer/sync-manager.ts';

export function registerIndexStatus(
  server: McpServer,
  db: VectorDB,
  embedder: { model: string },
  syncManager: SyncManager,
  dbPath: string,
): void {
  server.registerTool(
    'get_index_status',
    {
      description: 'Get current index health and status',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {},
      }),
    },
    (_input: unknown) => {
      const documentCount = db.getDocumentCount();
      const docCount = db.getDocumentCountByType('doc');
      const codeCount = db.getDocumentCountByType('code');
      const lastDocsSyncAt = db.getLastSyncAt('docs');
      const lastCodeSyncAt = db.getLastSyncAt('code');
      const embeddingDim = db.getStoredDimensions();
      const syncStatus = syncManager.status;

      return Promise.resolve({
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            document_count: documentCount,
            doc_count: docCount,
            code_count: codeCount,
            last_docs_sync_at: lastDocsSyncAt?.toISOString() ?? null,
            last_code_sync_at: lastCodeSyncAt?.toISOString() ?? null,
            embedding_model: embedder.model,
            embedding_dim: embeddingDim,
            db_path: dbPath,
            sync_in_progress: syncStatus.inProgress,
            sync_operation: syncStatus.operation,
          }, null, 2),
        }],
      });
    }
  );
}
