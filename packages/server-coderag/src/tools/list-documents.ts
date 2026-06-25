import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { VectorDB } from '../vectordb/db.js';

export function registerListDocuments(server: McpServer, db: VectorDB): void {
  server.registerTool(
    'list_documents',
    {
      description: 'List all indexed documents with their last modification timestamps.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {},
      }),
    },
    (_input: unknown) => {
      const docs = db.listDocuments();
      const documents = Array.from(docs.entries()).map(([filename, modifiedAt]) => ({
        filename,
        modified_at: modifiedAt.toISOString(),
      }));
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ documents, count: documents.length }, null, 2) }],
      });
    }
  );
}
