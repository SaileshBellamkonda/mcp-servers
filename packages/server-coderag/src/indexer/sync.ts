import { existsSync } from 'node:fs';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from './indexer.js';
import type { McpLogger } from '../core/logger.js';

export interface SyncResult {
  indexed: number;
  skipped: number;
  failed: number;
  removed: number;
}

export async function syncDocuments(
  documentsDir: string,
  db: VectorDB,
  indexer: Indexer,
  logger?: McpLogger,
): Promise<SyncResult> {
  const log = (msg: string) =>
    logger ? logger.info(msg) : process.stderr.write(`[INFO] ${msg}\n`);

  log(`Syncing documents in: ${documentsDir}`);

  const existingDocs = db.listDocuments();
  let removed = 0;

  for (const [filename] of existingDocs) {
    if (!existsSync(filename)) {
      try {
        db.deleteDocument(filename);
        removed++;
        log(`Removed stale index entry: ${filename}`);
      } catch {
        // ignore
      }
    }
  }

  let indexed = 0;
  let skipped = 0;
  let failed = 0;

  if (existsSync(documentsDir)) {
    const result = await indexer.indexMarkdownDirectory(documentsDir, false);
    indexed = result.indexed;
    skipped = result.skipped;
    failed = result.failed;
  }

  log(
    `Sync complete: ${String(indexed)} indexed, ${String(skipped)} skipped, ${String(failed)} failed, ${String(removed)} removed`,
  );

  return { indexed, skipped, failed, removed };
}
