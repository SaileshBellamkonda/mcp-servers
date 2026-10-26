import { existsSync } from 'node:fs';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from './indexer.js';
import type { CodeRagLogger } from '../core/logger.js';
import type { GlobMatcher } from '../core/glob-utils.js';
import { isSupportedExtension } from './languages.js';

/**
 * Brings the index entry of one file up to date: removes it when the file is gone, re-indexes it (documents or
 * code, as its type says) when it still matches the include rules. Shared by the file watcher and by the
 * background refresh that follows a search which met changed files.
 */
export class FileRefresher {
  private readonly db: VectorDB;
  private readonly indexer: Indexer;
  private readonly docsMatcher: GlobMatcher;
  private readonly codeMatcher: GlobMatcher;
  private readonly logger: CodeRagLogger;

  constructor(db: VectorDB, indexer: Indexer, docsMatcher: GlobMatcher, codeMatcher: GlobMatcher, logger: CodeRagLogger) {
    this.db = db;
    this.indexer = indexer;
    this.docsMatcher = docsMatcher;
    this.codeMatcher = codeMatcher;
    this.logger = logger;
  }

  /** False when re-indexing the file failed (the failure is logged); true otherwise. */
  async refresh(filePath: string): Promise<boolean> {
    if (!existsSync(filePath)) {
      try {
        this.db.deleteDocument(filePath);
        this.logger.info(`Removed stale index entry ${filePath}`);
      } catch {
        // File was not indexed — nothing to remove
      }
      return true;
    }

    const ext = path.extname(filePath).toLowerCase();

    if (this.indexer.isDocumentFile(filePath)) {
      if (!this.docsMatcher.isIncluded(filePath)) return true;
      try {
        await this.indexer.indexFile(filePath);
      } catch (err) {
        this.logger.warning(`Failed to re-index ${filePath}: ${String(err)}`);
        return false;
      }
    } else if (isSupportedExtension(ext)) {
      if (!this.codeMatcher.isIncluded(filePath)) return true;
      try {
        await this.indexer.indexCodeFile(filePath);
      } catch (err) {
        this.logger.warning(`Failed to re-index code ${filePath}: ${String(err)}`);
        return false;
      }
    }
    return true;
  }
}
