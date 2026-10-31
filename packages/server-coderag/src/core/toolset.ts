import { parseBool } from '@mcp-servers/common';
import { ConfigError } from './types.ts';
import type { Env } from './config.ts';

/**
 * Which tools a server offers. Every tool definition is sent to the model in every session, so the default offers
 * only what an agent needs to find code and to see or refresh the index.
 * - `search`: the search tool only.
 * - `standard` (default): `search`, `search_relations`, `get_index_status` and `sync_documents`. `search_relations`
 *   answers "who calls this", "what does this file import" and "what extends this" in one call, which otherwise takes
 *   several searches and file reads; the indexer records the relations of TypeScript, JavaScript, Python, Go, Rust, Java
 *   and C# code. The index follows the files by itself (start-up scan, file watcher, refresh of changed files after a
 *   search), so what is left for an agent is to check how healthy the index is and to force a rescan of documents and
 *   code; `sync_documents` is that rescan. The tools that index single paths, delete entries or write frontmatter are
 *   administration, not search.
 * - `all`: every tool.
 */
export const TOOLSETS = ['search', 'standard', 'all'] as const;
export type Toolset = (typeof TOOLSETS)[number];

export const DEFAULT_TOOLSET: Toolset = 'standard';

const STANDARD_TOOLS: ReadonlySet<string> = new Set(['search', 'search_relations', 'get_index_status', 'sync_documents']);

/** Reads a toolset name; blank or unset means the default. `setting` names the source in the error message. */
export function parseToolset(raw: unknown, setting = 'CODERAG_TOOLSET'): Toolset {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return DEFAULT_TOOLSET;
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const match = TOOLSETS.find((candidate) => candidate === name);
  if (match === undefined) {
    throw new ConfigError(`${setting} must be one of ${TOOLSETS.join(', ')} (got ${JSON.stringify(raw)}).`);
  }
  return match;
}

export function isToolEnabled(toolset: Toolset, toolName: string): boolean {
  if (toolset === 'all') return true;
  if (toolset === 'search') return toolName === 'search';
  return STANDARD_TOOLS.has(toolName);
}

export interface RuntimeOptions {
  /** Watch the include directories and re-index changed files as they change. */
  watch: boolean;
  toolset: Toolset;
}

/** `CODERAG_WATCH` (default on; `0`/`false`/`no`/`off` disable it) and `CODERAG_TOOLSET` (default `standard`). */
export function loadRuntimeOptionsFromEnv(env: Env = process.env): RuntimeOptions {
  return {
    watch: parseBool(env['CODERAG_WATCH'], true),
    toolset: parseToolset(env['CODERAG_TOOLSET']),
  };
}
