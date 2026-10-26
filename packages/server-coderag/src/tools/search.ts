import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import type { SearchFilter } from '../core/types.js';
import { PathGuard } from '../core/path-guard.js';
import { dropContainersOfMatches, formatConcise } from './search-format.js';
import { applyFreshness, type SearchFreshness } from './search-freshness.js';

const DEFAULT_MAX_TOKENS = 1500;

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
  max_tokens: z.number().int().positive().optional().describe('Output budget in estimated tokens (chars / 4), default 1500'),
  offset: z.number().int().nonnegative().optional().describe('Number of results to skip, for paging'),
  response_format: z.enum(['concise', 'detailed']).optional().describe('concise (default) or detailed (full JSON)'),
});

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

export function registerSearch(
  server: McpServer,
  db: VectorDB,
  embedder: Embedder,
  defaultTopK: number,
  pathGuard: PathGuard = new PathGuard([process.cwd()]),
  freshness?: SearchFreshness,
): void {
  server.registerTool(
    'search',
    {
      description: 'Search indexed code and documents (semantic, keyword or hybrid). Returns compact text: per hit path:lines, symbol, signature, short snippet and a 0-1 score (hybrid: 1 = ranked first by both searches); read the file for full code. Limit with max_tokens, page with offset; response_format "detailed" returns full JSON. tags, doc_type, domain, project filter on frontmatter (documents only).',
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
            description: 'Search mode: semantic (vector similarity, default), keyword (BM25 full-text: splits camelCase/snake_case, matches the last word as a prefix, falls back to any-word matches), or hybrid (merged results)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only documents having ALL of these frontmatter tags (case-insensitive)',
          },
          doc_type: { type: 'string', description: 'Only documents whose frontmatter doc_type matches (case-insensitive), e.g. "guide", "spec"' },
          domain: { type: 'string', description: 'Only documents whose frontmatter domain matches (case-insensitive), e.g. "backend"' },
          project: { type: 'string', description: 'Only documents whose frontmatter project matches (case-insensitive)' },
          max_tokens: { type: 'integer', minimum: 1, description: 'Output budget in estimated tokens (chars / 4), default 1500. Extra hits are left out with a note.' },
          offset: { type: 'integer', minimum: 0, description: 'Number of results to skip, for paging (default 0)' },
          response_format: {
            type: 'string',
            enum: ['concise', 'detailed'],
            description: 'concise (default): compact text. detailed: JSON with whole chunks, absolute paths and metadata',
          },
        },
        required: ['query'],
      }),
    },
    async (input: unknown) => {
      const { query, top_k, directory, file_pattern, mode, tags, doc_type, domain, project, max_tokens, offset, response_format } =
        SearchSchema.parse(input);
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

      const skip = offset ?? 0;
      const concise = response_format !== 'detailed';
      // Concise output drops a class when its method matched too, so fetch extra hits to still fill the page.
      const fetchCount = concise ? (skip + topK) * 2 : skip + topK;

      let found;
      if (searchMode === 'keyword') {
        found = db.searchByKeyword(query, fetchCount, filter);
      } else if (searchMode === 'hybrid') {
        const queryVector = await embedder.embed(query);
        found = db.searchHybrid(queryVector, query, fetchCount, filter);
      } else {
        const queryVector = await embedder.embed(query);
        found = db.searchWithFilter(queryVector, fetchCount, filter);
      }

      found = applyFreshness(found, freshness);

      if (!concise) {
        const results = found.slice(skip, skip + topK);
        return {
          content: [{ type: 'text', text: JSON.stringify({ results, count: results.length, mode: searchMode }, null, 2) }],
        };
      }

      const text = formatConcise(dropContainersOfMatches(found), {
        roots: pathGuard.roots,
        offset: skip,
        limit: topK,
        maxTokens: max_tokens ?? DEFAULT_MAX_TOKENS,
        mode: searchMode,
      });
      return { content: [{ type: 'text', text }] };
    }
  );
}
