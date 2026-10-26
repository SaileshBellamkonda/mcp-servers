import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import { PathGuard } from '../core/path-guard.js';
import { relativePath } from './search-format.js';

const SearchRelationsSchema = z.object({
  symbol: z.string().min(1).describe('Symbol name to search relations for (function, class, etc.)'),
  relation_type: z.string().optional().describe('Filter by type: calls | imports | inherits'),
  direction: z.enum(['incoming', 'outgoing', 'both']).optional().describe('Direction: incoming (callers), outgoing (callees), both (default)'),
});

export function registerSearchRelations(server: McpServer, db: VectorDB, pathGuard: PathGuard = new PathGuard([process.cwd()])): void {
  server.registerTool(
    'search_relations',
    {
      description: 'Find code symbol relationships: call graph, imports, inheritance. The indexer does not record relations yet, so results are normally empty.',
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
      const relations = db.findSymbolRelations(symbol, dir, relation_type ?? '').map((relation) => ({
        ...relation,
        targetFile: relativePath(relation.targetFile, pathGuard.roots),
        ...(relation.sourceFile !== undefined && { sourceFile: relativePath(relation.sourceFile, pathGuard.roots) }),
      }));

      return Promise.resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({ symbol, direction: dir, relations, count: relations.length }, null, 2),
        }],
      });
    }
  );
}
