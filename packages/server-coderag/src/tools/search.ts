import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';

const SearchSchema = z.object({
  query: z.string().min(1).describe('Natural language search query'),
  top_k: z.number().int().positive().optional().describe('Max results to return (default: 5)'),
  directory: z.string().optional().describe('Restrict search to documents under this directory'),
  file_pattern: z.string().optional().describe('Glob pattern for filename filtering (e.g. "*.md", "api-*.ts")'),
});

export function registerSearch(server: McpServer, db: VectorDB, embedder: Embedder, defaultTopK: number): void {
  server.registerTool(
    'search',
    {
      description: 'Semantic vector search over indexed documents and code. Returns ranked chunks.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          top_k: { type: 'number', description: 'Max results to return (default: 5)' },
          directory: { type: 'string', description: 'Restrict search to documents under this directory' },
          file_pattern: { type: 'string', description: 'Glob pattern for filename filtering (e.g. "*.md", "api-*.ts")' },
        },
        required: ['query'],
      }),
    },
    async (input: unknown) => {
      const { query, top_k, directory, file_pattern } = SearchSchema.parse(input);
      const topK = top_k ?? defaultTopK;

      const filter = directory ?? file_pattern
        ? { directory: directory ?? '', filePattern: file_pattern ?? '' }
        : null;

      const queryVector = await embedder.embed(query);
      const results = db.searchWithFilter(queryVector, topK, filter);

      return {
        content: [{ type: 'text', text: JSON.stringify({ results, count: results.length }, null, 2) }],
      };
    }
  );
}
