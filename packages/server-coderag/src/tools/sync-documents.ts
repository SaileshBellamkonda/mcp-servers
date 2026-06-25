import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from '../indexer/indexer.js';
import { syncDocuments } from '../indexer/sync.js';
import type { McpLogger } from '../core/logger.js';

const SyncDocumentsSchema = z.object({
  directory: z.string().optional().describe('Directory to sync (defaults to the configured documentsDir)'),
});

export function registerSyncDocuments(
  server: McpServer,
  db: VectorDB,
  indexer: Indexer,
  defaultDocumentsDir: string,
  logger?: McpLogger,
): void {
  server.registerTool(
    'sync_documents',
    {
      description:
        'Scan the documents directory for new or changed markdown files, index them, and remove stale index entries for files that no longer exist. ' +
        'Run this after adding or updating markdown files to make them searchable.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: `Directory to sync. Defaults to the configured documentsDir (${defaultDocumentsDir}).`,
          },
        },
      }),
    },
    async (input: unknown) => {
      const { directory } = SyncDocumentsSchema.parse(input);
      const targetDir = directory?.trim() || defaultDocumentsDir;
      const result = await syncDocuments(targetDir, db, indexer, logger);
      logger?.info({ tool: 'sync_documents', directory: targetDir, ...result });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              directory: targetDir,
              ...result,
            }),
          },
        ],
      };
    }
  );
}
