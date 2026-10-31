import { watch, existsSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.ts';
import type { Indexer } from './indexer.ts';
import type { CodeRagLogger } from '../core/logger.ts';
import type { SyncManager } from './sync-manager.ts';
import type { GlobMatcher } from '../core/glob-utils.ts';
import { FileRefresher } from './refresher.ts';
import { extractGlobBase, resolveToAbsolute } from '../core/glob-utils.ts';
import type { GlobConfig } from '../core/types.ts';

/** The directories to watch: the base directory of every document and code include pattern, each listed once. */
export function computeWatchDirs(globs: Pick<GlobConfig, 'docsInclude' | 'codeInclude'>, cwd: string): string[] {
  const patterns = [...globs.docsInclude, ...globs.codeInclude];
  return [...new Set(patterns.map((pattern) => extractGlobBase(resolveToAbsolute(pattern, cwd)).replace(/\/+$/, '') || cwd))];
}

export class CodeRagWatcher {
  private readonly refresher: FileRefresher;
  private readonly syncManager: SyncManager;
  private readonly logger: CodeRagLogger;
  private readonly debounceMs: number;
  private readonly watchers: FSWatcher[] = [];
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    db: VectorDB,
    indexer: Indexer,
    syncManager: SyncManager,
    docsMatcher: GlobMatcher,
    codeMatcher: GlobMatcher,
    logger: CodeRagLogger,
    debounceMs = 500,
  ) {
    this.refresher = new FileRefresher(db, indexer, docsMatcher, codeMatcher, logger);
    this.syncManager = syncManager;
    this.logger = logger;
    this.debounceMs = debounceMs;
  }

  start(watchDirs: string[]): void {
    for (const dir of watchDirs) {
      if (!existsSync(dir)) continue;
      try {
        const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;
          // Normalize to forward slashes for cross-platform consistency
          const fullPath = path.isAbsolute(filename)
            ? filename.replace(/\\/g, '/')
            : (dir + '/' + filename).replace(/\\/g, '/');
          this.debounce(fullPath, () => void this.handleChange(fullPath));
        });
        watcher.on('error', (err) => {
          this.logger.warning(`File watcher error in ${dir}: ${String(err)}`);
        });
        this.watchers.push(watcher);
        this.logger.info(`Watching directory: ${dir}`);
      } catch (err) {
        this.logger.warning(
          `Cannot watch ${dir}: ${String(err)}. Recursive fs.watch is not supported on Linux — use sync_documents tool instead.`,
        );
      }
    }
  }

  close(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers.length = 0;
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        fn();
      }, this.debounceMs),
    );
  }

  private async handleChange(filePath: string): Promise<void> {
    // Don't conflict with an ongoing manual sync
    if (this.syncManager.inProgress) return;
    await this.refresher.refresh(filePath);
  }
}
