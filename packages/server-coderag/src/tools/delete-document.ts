import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.ts';
import type { SyncManager } from '../indexer/sync-manager.ts';
import { syncLockedResponse } from '../indexer/sync-manager.ts';
import type { PathGuard } from '../core/path-guard.ts';

const DeleteDocumentSchema = z.object({
  filename: z.string().min(1),
});

export function registerDeleteDocument(server: McpServer, db: VectorDB, syncManager: SyncManager, pathGuard: PathGuard): void {
  server.registerTool(
    'delete_document',
    {
      description: 'Remove a document from the index (DB only — does not delete the file on disk). Returns { locked: true } if a sync is in progress.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Full path of the file to remove from the index' },
        },
        required: ['filename'],
      }),
    },
    (input: unknown) => {
      if (syncManager.inProgress) return Promise.resolve(syncLockedResponse(syncManager.status));
      const { filename: requested } = DeleteDocumentSchema.parse(input);
      return Promise.resolve().then(async () => {
        const filename = pathGuard.assertAllowed(requested);
        db.deleteDocument(filename);
        // Relations of other files that pointed at the deleted file's symbols are resolved again.
        await db.resolvePendingRelations();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, filename }) }] };
      });
    }
  );
}
