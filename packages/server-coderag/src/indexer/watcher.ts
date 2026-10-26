import { watch, existsSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from './indexer.js';
import type { McpLogger } from '@mcp-servers/common';
import type { SyncManager } from './sync-manager.js';
import type { GlobMatcher } from '../core/glob-utils.js';
import { isSupportedExtension } from './languages.js';

export class CodeRagWatcher {
  private readonly db: VectorDB;
  private readonly indexer: Indexer;
  private readonly syncManager: SyncManager;
  private readonly docsMatcher: GlobMatcher;
  private readonly codeMatcher: GlobMatcher;
  private readonly logger: McpLogger;
  private readonly debounceMs: number;
  private readonly watchers: FSWatcher[] = [];
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    db: VectorDB,
    indexer: Indexer,
    syncManager: SyncManager,
    docsMatcher: GlobMatcher,
    codeMatcher: GlobMatcher,
    logger: McpLogger,
    debounceMs = 500,
  ) {
    this.db = db;
    this.indexer = indexer;
    this.syncManager = syncManager;
    this.docsMatcher = docsMatcher;
    this.codeMatcher = codeMatcher;
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

    if (!existsSync(filePath)) {
      try {
        this.db.deleteDocument(filePath);
        this.logger.info(`Watcher: removed stale index entry ${filePath}`);
      } catch {
        // File was not indexed — nothing to remove
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    if (this.indexer.isDocumentFile(filePath)) {
      if (!this.docsMatcher.isIncluded(filePath)) return;
      try {
        await this.indexer.indexFile(filePath);
      } catch (err) {
        this.logger.warning(`Watcher: failed to re-index ${filePath}: ${String(err)}`);
      }
    } else if (isSupportedExtension(ext)) {
      if (!this.codeMatcher.isIncluded(filePath)) return;
      try {
        await this.indexer.indexCodeFile(filePath);
      } catch (err) {
        this.logger.warning(`Watcher: failed to re-index code ${filePath}: ${String(err)}`);
      }
    }
  }
}
