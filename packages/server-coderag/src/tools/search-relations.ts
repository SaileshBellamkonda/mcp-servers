import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';

const SearchRelationsSchema = z.object({
  symbol: z.string().min(1).describe('Symbol name to search relations for (function, class, etc.)'),
  relation_type: z.string().optional().describe('Filter by type: calls | imports | inherits'),
  direction: z.enum(['incoming', 'outgoing', 'both']).optional().describe('Direction: incoming (callers), outgoing (callees), both (default)'),
});

export function registerSearchRelations(server: McpServer, db: VectorDB): void {
  server.registerTool(
    'search_relations',
    {
      description: 'Find code symbol relationships: call graph, imports, inheritance. Use after index_code.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to search relations for (function, class, etc.)' },
          relation_type: { type: 'string', description: 'Filter by type: calls | imports | inherits' },
          direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], description: 'Direction: incoming (callers), outgoing (callees), both (default)' },
        },
        required: ['symbol'],
      }),
    },
    (input: unknown) => {
      const { symbol, relation_type, direction } = SearchRelationsSchema.parse(input);
      const dir = direction ?? 'both';
      const relations = db.findSymbolRelations(symbol, dir, relation_type ?? '');

      return Promise.resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({ symbol, direction: dir, relations, count: relations.length }, null, 2),
        }],
      });
    }
  );
}
