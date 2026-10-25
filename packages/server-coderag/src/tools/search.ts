import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import type { SearchFilter } from '../core/types.js';

const SearchSchema = z.object({
  query: z.string().min(1).describe('Natural language search query'),
  top_k: z.number().int().positive().optional().describe('Max results to return (default: 5)'),
  directory: z.string().optional().describe('Restrict search to documents under this directory'),
  file_pattern: z.string().optional().describe('Glob pattern for filename filtering (e.g. "*.md", "api-*.ts")'),
  mode: z.enum(['semantic', 'keyword', 'hybrid']).optional().describe('Search mode: semantic (vector, default), keyword (FTS5 BM25), or hybrid (merged)'),
  tags: z.array(z.string()).optional().describe('Only documents having ALL of these frontmatter tags'),
  doc_type: z.string().optional().describe('Only documents whose frontmatter doc_type matches (e.g. "guide", "spec")'),
  domain: z.string().optional().describe('Only documents whose frontmatter domain matches (e.g. "backend")'),
  project: z.string().optional().describe('Only documents whose frontmatter project matches'),
});

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

export function registerSearch(server: McpServer, db: VectorDB, embedder: Embedder, defaultTopK: number): void {
  server.registerTool(
    'search',
    {
      description: 'Search over indexed documents and code. Supports semantic (vector), keyword (FTS5), and hybrid modes. Document results include heading path, line numbers and frontmatter metadata; tags, doc_type, domain and project filter on that metadata (code files have none, so those filters return documents only).',
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
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only documents having ALL of these frontmatter tags (case-insensitive)',
          },
          doc_type: { type: 'string', description: 'Only documents whose frontmatter doc_type matches (case-insensitive), e.g. "guide", "spec"' },
          domain: { type: 'string', description: 'Only documents whose frontmatter domain matches (case-insensitive), e.g. "backend"' },
          project: { type: 'string', description: 'Only documents whose frontmatter project matches (case-insensitive)' },
        },
        required: ['query'],
      }),
    },
    async (input: unknown) => {
      const { query, top_k, directory, file_pattern, mode, tags, doc_type, domain, project } = SearchSchema.parse(input);
      const topK = top_k ?? defaultTopK;
      const searchMode = mode ?? 'semantic';

      const hasTags = tags !== undefined && tags.length > 0;
      const hasFilter =
        isSet(directory) || isSet(file_pattern) || isSet(doc_type) || isSet(domain) || isSet(project) || hasTags;
      const filter: SearchFilter | null = hasFilter
        ? {
            directory: directory ?? '',
            filePattern: file_pattern ?? '',
            tags: hasTags ? tags : undefined,
            docType: doc_type,
            domain,
            project,
          }
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
