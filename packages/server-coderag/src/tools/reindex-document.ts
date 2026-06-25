import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from '../indexer/indexer.js';
import { isSupportedExtension } from '../indexer/languages.js';

const ReindexDocumentSchema = z.object({
  filename: z.string().min(1).describe('Full path of the file to delete and re-index'),
});

export function registerReindexDocument(server: McpServer, db: VectorDB, indexer: Indexer): void {
  server.registerTool(
    'reindex_document',
    {
      description: 'Delete and re-index a file. Works for both markdown and source code files.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Full path of the file to delete and re-index' },
        },
        required: ['filename'],
      }),
    },
    async (input: unknown) => {
      const { filename } = ReindexDocumentSchema.parse(input);

      // Delete existing index entry if present
      try {
        db.deleteDocument(filename);
      } catch {
        // Not previously indexed — that's fine, just index fresh
      }

      const ext = path.extname(filename).toLowerCase();
      if (isSupportedExtension(ext)) {
        await indexer.indexCodeFile(filename);
      } else {
        await indexer.indexFile(filename);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, filename }) }],
      };
    }
  );
}
