import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { RelationEndpoint, RelationHit, RelationPage, VectorDB } from '../vectordb/db.js';
import { PathGuard } from '../core/path-guard.js';
import { CHARS_PER_TOKEN, relativePath } from './search-format.js';

const DEFAULT_MAX_TOKENS = 1000;
/** Relations fetched per call; the token budget cuts the page well before this. */
const FETCH_LIMIT = 200;
const MAX_IMPORT_NAMES = 5;
/** Characters kept free for the "+N more" line whenever more lines may follow. */
const FOOTER_RESERVE_CHARS = 90;
const CALLS_CAP_NOTE = 'cap of 50 per symbol';

const RELATION_TYPES = ['calls', 'imports', 'inherits'] as const;
const DIRECTIONS = ['in', 'out', 'both'] as const;

const SearchRelationsSchema = z.object({
  symbol: z.string().min(1),
  relation_type: z.enum(RELATION_TYPES).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  max_tokens: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  response_format: z.enum(['concise', 'detailed']).optional(),
});

function qualified(endpoint: RelationEndpoint): string {
  return endpoint.parent === '' ? endpoint.name : `${endpoint.parent}.${endpoint.name}`;
}

function clipNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, MAX_IMPORT_NAMES).join(', ');
  return ` {${shown}${names.length > MAX_IMPORT_NAMES ? `, +${String(names.length - MAX_IMPORT_NAMES)}` : ''}}`;
}

/** `kind  path:line Source -> target [target-path:line] (confidence)`; only an unresolved target shows the name as written. */
function renderHit(hit: RelationHit, roots: readonly string[]): string {
  const where = `${relativePath(hit.source.file, roots)}:${String(hit.line)}`;
  const score = `(${hit.confidence.toFixed(2)})`;
  if (hit.type === 'imports') {
    const file = hit.targetFile === '' ? '' : ` [${relativePath(hit.targetFile, roots)}]`;
    return `imports  ${where} -> ${hit.targetName}${file}${clipNames(hit.names)} ${score}`;
  }
  const target = hit.target
    ? `${qualified(hit.target)} [${relativePath(hit.target.file, roots)}:${String(hit.target.startLine)}]`
    : hit.targetName;
  return `${hit.type}  ${where} ${qualified(hit.source)} -> ${target} ${score}`;
}

function omittedNote(page: RelationPage): string {
  return page.omitted.map((o) => `+${String(o.count)} ${o.type} not recorded (${CALLS_CAP_NOTE})`).join('\n');
}

function emptyHint(symbol: string, direction: 'in' | 'out' | 'both', page: RelationPage): string {
  if (page.symbols === 0) {
    return `No indexed symbol or file matches "${symbol}". Use search to find the exact name, then ask again.`;
  }
  const which = direction === 'both' ? '' : `${direction === 'in' ? 'incoming' : 'outgoing'} `;
  return `No ${which}relations recorded for "${symbol}" (names are matched as written; calls to common built-in names are skipped). Use search to look at the code.`;
}

function formatConcise(page: RelationPage, symbol: string, direction: 'in' | 'out' | 'both', roots: readonly string[], offset: number, maxTokens: number): string {
  if (page.hits.length === 0) return emptyHint(symbol, direction, page);

  const budget = maxTokens * CHARS_PER_TOKEN;
  const mixed = page.hits.some((h) => h.direction === 'out') && page.hits.some((h) => h.direction === 'in');
  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  let noteDone = page.omitted.length === 0;
  let current: 'in' | 'out' | undefined;

  const push = (line: string, reserve: number): boolean => {
    if (lines.length > 0 && used + line.length + 1 + reserve > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  const closeOutgoing = (): void => {
    if (noteDone) return;
    noteDone = true;
    push(omittedNote(page), 0);
  };

  let cut = false;
  for (const [index, hit] of page.hits.entries()) {
    const reserve = index < page.hits.length - 1 || page.total > offset + page.hits.length ? FOOTER_RESERVE_CHARS : 0;
    if (current !== hit.direction) {
      if (current === 'out') closeOutgoing();
      current = hit.direction;
      if (mixed && !push(hit.direction === 'out' ? 'outgoing:' : 'incoming:', reserve + 40)) {
        cut = true;
        break;
      }
    }
    if (!push(renderHit(hit, roots), reserve)) {
      cut = true;
      break;
    }
    shown++;
  }
  if (!cut && current === 'out') closeOutgoing();

  const remaining = page.total - offset - shown;
  if (remaining > 0) {
    lines.push(`+${String(remaining)} more; narrow with relation_type or direction, or pass offset=${String(offset + shown)}`);
  }
  return lines.join('\n');
}

function endpointJson(endpoint: RelationEndpoint | undefined, roots: readonly string[]): RelationEndpoint | undefined {
  return endpoint ? { ...endpoint, file: relativePath(endpoint.file, roots) } : undefined;
}

export function registerSearchRelations(server: McpServer, db: VectorDB, pathGuard: PathGuard = new PathGuard([process.cwd()])): void {
  server.registerTool(
    'search_relations',
    {
      description: 'Relations between code symbols, recorded at index time (TypeScript, TSX, JavaScript, Python, Go, Rust, Java, C#): calls (callers and callees), imports (who imports a symbol or file, what a file imports), inherits (subclasses and base classes). Matching is by name, so results are approximate: confidence 0.9 = unique match, 0.5 = ambiguous name (raw name shown), 0.3 = not found in the index; very common built-in names are not recorded. Compact text, one line per relation; read the file to confirm.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Name, Class.method or file path (src/a.ts)' },
          relation_type: { type: 'string', enum: [...RELATION_TYPES], description: 'Only this kind (default: all; file paths: imports)' },
          direction: { type: 'string', enum: [...DIRECTIONS], description: 'in = callers/importers/subclasses, out = callees/imports/bases, both (default)' },
          max_tokens: { type: 'integer', minimum: 1, description: 'Output budget in estimated tokens (chars / 4), default 1000' },
          offset: { type: 'integer', minimum: 0, description: 'Relations to skip, for paging' },
          response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'concise (default) or detailed (JSON)' },
        },
        required: ['symbol'],
      }),
    },
    (input: unknown) => Promise.resolve().then(() => {
      const { symbol, relation_type, direction, max_tokens, offset, response_format } = SearchRelationsSchema.parse(input);
      const dir = direction ?? 'both';
      const skip = offset ?? 0;
      const page = db.queryRelations({ symbol, direction: dir, types: relation_type ? [relation_type] : undefined, limit: FETCH_LIMIT, offset: skip });
      const roots = pathGuard.roots;

      if (response_format === 'detailed') {
        const relations = page.hits.map((hit) => ({
          ...hit,
          source: endpointJson(hit.source, roots),
          targetFile: hit.targetFile === '' ? '' : relativePath(hit.targetFile, roots),
          target: endpointJson(hit.target, roots),
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify({ symbol, direction: dir, total: page.total, offset: skip, relations, omitted: page.omitted }, null, 2) }],
        };
      }
      return {
        content: [{ type: 'text', text: formatConcise(page, symbol, dir, roots, skip, max_tokens ?? DEFAULT_MAX_TOKENS) }],
      };
    })
  );
}
