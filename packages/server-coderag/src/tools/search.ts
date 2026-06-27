import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';

const SearchSchema = z.object({
  query: z.string().min(1).describe('Natural language search query'),
  top_k: z.number().int().positive().optional().describe('Max results to return (default: 5)'),
  directory: z.string().optional().describe('Restrict search to documents under this directory'),
  file_pattern: z.string().optional().describe('Glob pattern for filename filtering (e.g. "*.md", "api-*.ts")'),
  mode: z.enum(['semantic', 'keyword', 'hybrid']).optional().describe('Search mode: semantic (vector, default), keyword (FTS5 BM25), or hybrid (merged)'),
});

export function registerSearch(server: McpServer, db: VectorDB, embedder: Embedder, defaultTopK: number): void {
  server.registerTool(
    'search',
    {
      description: 'Search over indexed documents and code. Supports semantic (vector), keyword (FTS5), and hybrid modes.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          top_k: { type: 'number', description: 'Max results to return (default: 5)' },
          directory: { type: 'string', description: 'Restrict search to documents under this directory' },
          file_pattern: { type: 'string', description: 'Glob pattern for filename filtering (e.g. "*.md", "api-*.ts")' },
          mode: {
            type: 'string',
            enum: ['semantic', 'keyword', 'hybrid'],
            description: 'Search mode: semantic (vector similarity, default), keyword (FTS5 BM25 full-text), or hybrid (merged results)',
          },
        },
        required: ['query'],
      }),
    },
    async (input: unknown) => {
      const { query, top_k, directory, file_pattern, mode } = SearchSchema.parse(input);
      const topK = top_k ?? defaultTopK;
      const searchMode = mode ?? 'semantic';

      const filter = directory ?? file_pattern
        ? { directory: directory ?? '', filePattern: file_pattern ?? '' }
        : null;

      let results;
      if (searchMode === 'keyword') {
        results = db.searchByKeyword(query, topK, filter);
      } else if (searchMode === 'hybrid') {
        const queryVector = await embedder.embed(query);
        results = db.searchHybrid(queryVector, query, topK, filter);
      } else {
        const queryVector = await embedder.embed(query);
        results = db.searchWithFilter(queryVector, topK, filter);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ results, count: results.length, mode: searchMode }, null, 2) }],
      };
    }
  );
}
