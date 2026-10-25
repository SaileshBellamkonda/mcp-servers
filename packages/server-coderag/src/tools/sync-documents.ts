import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from '../indexer/indexer.js';
import { syncDocuments, type SyncResult } from '../indexer/sync.js';
import type { McpLogger } from '../core/logger.js';
import type { SyncManager } from '../indexer/sync-manager.js';
import { syncLockedResponse, SyncInProgressError } from '../indexer/sync-manager.js';

const SyncDocumentsSchema = z.object({
  directory: z.string().optional(),
});

export function registerSyncDocuments(
  server: McpServer,
  db: VectorDB,
  indexer: Indexer,
  defaultIncludeDirs: string[],
  syncManager: SyncManager,
  logger?: McpLogger,
): void {
  server.registerTool(
    'sync_documents',
    {
      description:
        'Scan configured include directories for new or changed markdown and MDX documents, index them, and remove stale index entries. ' +
        'Pass an optional directory to sync only that path. Returns { locked: true } if a sync is in progress.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: `Single directory to sync. Omit to sync all configured directories: ${defaultIncludeDirs.join(', ')}.`,
          },
        },
      }),
    },
    async (input: unknown) => {
      if (syncManager.inProgress) return syncLockedResponse(syncManager.status);

      const { directory } = SyncDocumentsSchema.parse(input);
      const targetDirs = directory?.trim() ? [directory.trim()] : defaultIncludeDirs;

      let syncResult: SyncResult | undefined;
      try {
        await syncManager.run('sync_documents', async () => {
          syncResult = await syncDocuments(targetDirs, db, indexer, logger);
        });
      } catch (err) {
        if (err instanceof SyncInProgressError) return syncLockedResponse(syncManager.status);
        throw err;
      }

      const r = syncResult ?? { indexed: 0, skipped: 0, failed: 0, removed: 0 };
      logger?.info({ tool: 'sync_documents', directories: targetDirs, ...r });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, directories: targetDirs, ...r }) }] };
    }
  );
}
