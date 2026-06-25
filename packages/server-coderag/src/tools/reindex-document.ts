import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from '../indexer/indexer.js';
import type { SyncManager } from '../indexer/sync-manager.js';
import { syncLockedResponse } from '../indexer/sync-manager.js';
import { isSupportedExtension } from '../indexer/languages.js';

const ReindexDocumentSchema = z.object({
  filename: z.string().min(1),
});

export function registerReindexDocument(server: McpServer, db: VectorDB, indexer: Indexer, syncManager: SyncManager): void {
  server.registerTool(
    'reindex_document',
    {
      description: 'Delete and re-index a file. Works for both markdown and source code files. Returns { locked: true } if a sync is in progress.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Full path of the file to delete and re-index' },
        },
        required: ['filename'],
      }),
    },
    async (input: unknown) => {
      if (syncManager.inProgress) return syncLockedResponse(syncManager.status);

      const { filename } = ReindexDocumentSchema.parse(input);
      const ext = path.extname(filename).toLowerCase();
      const isCode = isSupportedExtension(ext);

      if (isCode && indexer.isCodeExcluded(filename)) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, excluded: true, filename, error: 'File is excluded by configured code exclusion patterns' }) }] };
      }
      if (!isCode && indexer.isDocExcluded(filename)) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, excluded: true, filename, error: 'File is excluded by configured docs exclusion patterns' }) }] };
      }

      try { db.deleteDocument(filename); } catch { /* not previously indexed */ }

      if (isCode) {
        await indexer.indexCodeFile(filename);
      } else {
        await indexer.indexFile(filename);
      }

      return { content: [{ type: 'text', text: JSON.stringify({ success: true, filename }) }] };
    }
  );
}
