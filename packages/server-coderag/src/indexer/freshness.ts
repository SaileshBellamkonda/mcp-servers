import { statSync } from 'node:fs';
import type { VectorDB } from '../vectordb/db.ts';
import type { CodeRagLogger } from '../core/logger.ts';
import { isUnchangedSince } from './indexer.ts';

/** `missing`: the file is gone; `changed`: its modification time differs from the indexed one. */
export type FileState = 'fresh' | 'changed' | 'missing';

export interface IndexFreshnessOptions {
  /** Wait after the last request before refreshing (default 1000 ms). */
  debounceMs?: number;
  /** A file whose refresh failed is not retried for this long (default 60 s), e.g. while the embedder is down. */
  failureCooldownMs?: number;
  /** Replaceable for tests. */
  stat?: (filePath: string) => { mtime: Date };
  now?: () => number;
}

/**
 * Keeps search results honest: `classify` checks, with one stat per file, whether files the index returned still
 * exist and still have the indexed modification time; `scheduleRefresh` re-indexes (or removes) such files in the
 * background, debounced, so the search response itself never waits for the embedder.
 */
export class IndexFreshness {
  private readonly db: VectorDB;
  private readonly refresher: { refresh(filePath: string): Promise<boolean> };
  private readonly syncManager: { readonly inProgress: boolean };
  private readonly logger: CodeRagLogger;
  private readonly debounceMs: number;
  private readonly failureCooldownMs: number;
  private readonly stat: (filePath: string) => { mtime: Date };
  private readonly now: () => number;
  private readonly pending = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    db: VectorDB,
    refresher: { refresh(filePath: string): Promise<boolean> },
    syncManager: { readonly inProgress: boolean },
    logger: CodeRagLogger,
    options: IndexFreshnessOptions = {},
  ) {
    this.db = db;
    this.refresher = refresher;
    this.syncManager = syncManager;
    this.logger = logger;
    this.debounceMs = options.debounceMs ?? 1000;
    this.failureCooldownMs = options.failureCooldownMs ?? 60_000;
    this.stat = options.stat ?? ((filePath) => statSync(filePath));
    this.now = options.now ?? Date.now;
  }

  classify(files: Iterable<string>): Map<string, FileState> {
    const states = new Map<string, FileState>();
    for (const filePath of files) {
      if (states.has(filePath)) continue;
      states.set(filePath, this.stateOf(filePath));
    }
    return states;
  }

  private stateOf(filePath: string): FileState {
    let mtime: Date;
    try {
      mtime = this.stat(filePath).mtime;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'fresh';
    }
    const indexed = this.db.getModifiedAt(filePath);
    return indexed === null || isUnchangedSince(mtime, indexed) ? 'fresh' : 'changed';
  }

  scheduleRefresh(files: Iterable<string>): void {
    if (this.closed) return;
    const now = this.now();
    for (const filePath of files) {
      const failed = this.failedAt.get(filePath);
      if (failed !== undefined && now - failed < this.failureCooldownMs) continue;
      this.pending.add(filePath);
    }
    if (this.pending.size === 0 || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, this.debounceMs);
    this.timer.unref();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }

  private async drain(): Promise<void> {
    const files = [...this.pending];
    this.pending.clear();
    // A manual sync or start-up scan is already bringing the index up to date.
    if (this.syncManager.inProgress) return;
    for (const filePath of files) {
      if (this.closed) return;
      let ok = false;
      try {
        ok = await this.refresher.refresh(filePath);
      } catch (err) {
        this.logger.warning(`Background refresh of ${filePath} failed: ${String(err)}`);
      }
      if (ok) this.failedAt.delete(filePath);
      else this.failedAt.set(filePath, this.now());
    }
  }
}
