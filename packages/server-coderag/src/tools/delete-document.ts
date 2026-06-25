import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';

const DeleteDocumentSchema = z.object({
  filename: z.string().min(1).describe('Full path of the file to remove from the index'),
});

export function registerDeleteDocument(server: McpServer, db: VectorDB): void {
  server.registerTool(
    'delete_document',
    {
      description: 'Remove a document from the index (DB only — does not delete the file on disk).',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Full path of the file to remove from the index' },
        },
        required: ['filename'],
      }),
    },
    (input: unknown) => {
      const { filename } = DeleteDocumentSchema.parse(input);
      return Promise.resolve().then(() => {
        db.deleteDocument(filename);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, filename }) }],
        };
      });
    }
  );
}
