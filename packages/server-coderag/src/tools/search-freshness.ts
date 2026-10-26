import type { SearchResult } from '../core/types.js';
import type { FileState } from '../indexer/freshness.js';

/** What `search` needs to keep results honest; implemented by `IndexFreshness`. */
export interface SearchFreshness {
  classify(files: Iterable<string>): Map<string, FileState>;
  scheduleRefresh(files: Iterable<string>): void;
}

/**
 * Hits of files that are gone are left out, hits of files changed since indexing are kept but flagged `stale`,
 * and both kinds of file are queued for a background refresh so the next search sees them up to date.
 */
export function applyFreshness(results: readonly SearchResult[], freshness: SearchFreshness | undefined): SearchResult[] {
  if (!freshness || results.length === 0) return [...results];
  const states = freshness.classify(results.map((r) => r.document));
  const outdated = [...states].filter(([, state]) => state !== 'fresh').map(([file]) => file);
  if (outdated.length > 0) freshness.scheduleRefresh(outdated);
  return results
    .filter((r) => states.get(r.document) !== 'missing')
    .map((r) => (states.get(r.document) === 'changed' ? { ...r, stale: true } : r));
}
