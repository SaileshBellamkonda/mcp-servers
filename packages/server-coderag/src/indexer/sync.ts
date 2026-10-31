import { existsSync } from 'node:fs';
import type { VectorDB } from '../vectordb/db.ts';
import type { Indexer } from './indexer.ts';
import type { CodeRagLogger } from '../core/logger.ts';
import type { GlobConfig } from '../core/types.ts';
import { GlobMatcher } from '../core/glob-utils.ts';
import { SyncManager } from './sync-manager.ts';
import { yieldToEventLoop } from './indexer.ts';
import { CODE_PARSER_VERSION } from './code-parser.ts';
import { RELATIONS_VERSION } from './relations.ts';

export interface SyncResult {
  indexed: number;
  skipped: number;
  failed: number;
  removed: number;
}

function globConfigEqual(a: GlobConfig, b: GlobConfig): boolean {
  const arrEq = (x: string[], y: string[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    arrEq([...a.docsInclude].sort(), [...b.docsInclude].sort()) &&
    arrEq([...a.docsExclude].sort(), [...b.docsExclude].sort()) &&
    arrEq([...a.codeInclude].sort(), [...b.codeInclude].sort()) &&
    arrEq([...a.codeExclude].sort(), [...b.codeExclude].sort())
  );
}

export async function syncDocuments(
  includeDirs: string[],
  db: VectorDB,
  indexer: Indexer,
  logger?: CodeRagLogger,
): Promise<SyncResult> {
  const log = (msg: string): void => {
    if (logger) { logger.info(msg); } else { process.stderr.write(`[INFO] ${msg}\n`); }
  };

  log(`Syncing documents in: ${includeDirs.join(', ')}`);

  const existingDocs = db.listDocumentsByType('doc');
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

  for (const dir of includeDirs) {
    if (existsSync(dir)) {
      const result = await indexer.indexMarkdownDirectory(dir, false);
      indexed += result.indexed;
      skipped += result.skipped;
      failed += result.failed;
    } else {
      log(`Directory not found, skipping: ${dir}`);
    }
  }

  log(`Sync complete: ${String(indexed)} indexed, ${String(skipped)} skipped, ${String(failed)} failed, ${String(removed)} removed`);
  return { indexed, skipped, failed, removed };
}

/** Incremental rescan of the configured source files: new and changed files are indexed, deleted ones are removed. */
export async function syncCode(db: VectorDB, indexer: Indexer, logger?: CodeRagLogger): Promise<SyncResult> {
  const scan = await indexer.scanCode(false);
  let removed = 0;
  for (const [filename] of db.listDocumentsByType('code')) {
    if (existsSync(filename)) continue;
    try {
      db.deleteDocument(filename);
      removed++;
      logger?.info(`Removed stale code: ${filename}`);
    } catch {
      // ignore
    }
  }
  await db.resolvePendingRelations({ yieldToEventLoop });
  return { indexed: scan.indexed, skipped: scan.skipped, failed: scan.failed, removed };
}

/**
 * Moves an index written with the old vector table to the cosine table (stored vectors are copied, nothing is
 * re-embedded). A failure is logged and does not stop the sync: searches keep using the old table, and the copy resumes
 * at the next start.
 */
async function upgradeVectorIndex(db: VectorDB, logger: CodeRagLogger): Promise<void> {
  if (db.isVectorIndexMigrated()) return;
  const started = Date.now();
  logger.info('Upgrading the vector index to the faster cosine layout (stored vectors are copied, nothing is re-embedded)...');
  try {
    const copied = await db.migrateVectorIndex({ yieldToEventLoop });
    logger.info(`Vector index upgraded: ${String(copied)} vectors in ${String(Date.now() - started)} ms`);
  } catch (err) {
    logger.warning(`Vector index upgrade failed (${String(err)}); searches keep using the slower scan and the upgrade continues at the next start`);
  }
}

export async function runStartupSync(
  db: VectorDB,
  indexer: Indexer,
  syncManager: SyncManager,
  config: { globs: GlobConfig; useGitignore: boolean },
  cwd: string,
  logger: CodeRagLogger,
): Promise<void> {
  await syncManager.run('startup', async () => {
    const storedRules = db.getStoredRules();
    const currentGlobs = config.globs;
    const noDocsIndexed = db.getDocumentCountByType('doc') === 0;
    const noCodeIndexed = db.getDocumentCountByType('code') === 0;
    const rulesChanged = storedRules === null || !globConfigEqual(storedRules, currentGlobs);
    // Set by a schema migration when existing docs must be re-embedded (e.g. new heading/metadata context).
    const docsReindexRequired = db.isDocsReindexRequired();
    // Indexed code written by an older parser (e.g. old signature rules) is re-parsed even though its files are unchanged.
    const codeParserStale = !noCodeIndexed && db.getCodeParserVersion() !== CODE_PARSER_VERSION;
    // Code indexed before relations were recorded (or by an older extractor) only needs its relations filled: the files
    // are parsed again, but not embedded. A forced re-parse (parser version) rebuilds them anyway.
    const relationsStale = !noCodeIndexed && !codeParserStale && (db.getRelationsVersion() ?? 0) < RELATIONS_VERSION;

    logger.info(`Startup sync: rules_changed=${String(rulesChanged)}, no_docs=${String(noDocsIndexed)}, no_code=${String(noCodeIndexed)}, docs_reindex=${String(docsReindexRequired)}, code_parser_stale=${String(codeParserStale)}, relations_stale=${String(relationsStale)}`);

    await upgradeVectorIndex(db, logger);

    const docsMatcher = new GlobMatcher(currentGlobs.docsInclude, currentGlobs.docsExclude, cwd, config.useGitignore);
    const codeMatcher = new GlobMatcher(currentGlobs.codeInclude, currentGlobs.codeExclude, cwd, config.useGitignore);

    if (rulesChanged && storedRules !== null) {
      // Rules tightened: prune DB entries that are now excluded or no longer included
      logger.info('Rules changed — pruning excluded documents...');
      pruneExcluded(db, docsMatcher, codeMatcher, logger);
    }

    // Every startup scans both kinds incrementally: only the files whose modification time differs from the stored
    // one are read, parsed and embedded (unchanged files cost one stat), and indexed files that are gone are removed.
    logger.info(docsReindexRequired ? 'Scanning docs (forced re-index)...' : 'Scanning docs...');
    const docsResult = await indexer.scanDocs(docsReindexRequired);
    logger.info(`Docs scan: ${String(docsResult.indexed)} indexed, ${String(docsResult.skipped)} skipped, ${String(docsResult.failed)} failed`);
    db.setLastSyncAt('docs', new Date());
    if (docsReindexRequired && docsResult.failed === 0) db.clearDocsReindexRequired();

    if (relationsStale) {
      logger.info('Filling code relations (imports, inheritance, calls); chunks and vectors are kept...');
      const filled = await indexer.backfillRelations();
      if (filled.failed === 0) db.setRelationsVersion(RELATIONS_VERSION);
    }

    logger.info(codeParserStale ? 'Scanning code (parser version changed, forced re-parse)...' : 'Scanning code...');
    const codeResult = await indexer.scanCode(codeParserStale);
    logger.info(`Code scan: ${String(codeResult.indexed)} indexed, ${String(codeResult.skipped)} skipped, ${String(codeResult.failed)} failed`);
    db.setLastSyncAt('code', new Date());
    // A failed forced scan leaves the marker unset, so the next startup tries again.
    if (!codeParserStale || codeResult.failed === 0) db.setCodeParserVersion(CODE_PARSER_VERSION);
    // Everything was parsed by this scan, so its relations are current too.
    if ((noCodeIndexed || codeParserStale) && codeResult.failed === 0) db.setRelationsVersion(RELATIONS_VERSION);

    await removeStaleDocs(db, logger);
    await removeStaleCode(db, logger);
    await db.resolvePendingRelations({ yieldToEventLoop });

    db.saveRules(currentGlobs);
    logger.info('Startup sync complete.');
  });
}

function pruneExcluded(
  db: VectorDB,
  docsMatcher: GlobMatcher,
  codeMatcher: GlobMatcher,
  logger: CodeRagLogger,
): void {
  for (const [filename] of db.listDocumentsByType('doc')) {
    if (!docsMatcher.isIncluded(filename)) {
      try { db.deleteDocument(filename); logger.info(`Pruned doc: ${filename}`); } catch { /* ignore */ }
    }
  }
  for (const [filename] of db.listDocumentsByType('code')) {
    if (!codeMatcher.isIncluded(filename)) {
      try { db.deleteDocument(filename); logger.info(`Pruned code: ${filename}`); } catch { /* ignore */ }
    }
  }
}

async function removeStaleDocs(db: VectorDB, logger: CodeRagLogger): Promise<void> {
  const { existsSync } = await import('node:fs');
  for (const [filename] of db.listDocumentsByType('doc')) {
    if (!existsSync(filename)) {
      try { db.deleteDocument(filename); logger.info(`Removed stale doc: ${filename}`); } catch { /* ignore */ }
    }
  }
}

async function removeStaleCode(db: VectorDB, logger: CodeRagLogger): Promise<void> {
  const { existsSync } = await import('node:fs');
  for (const [filename] of db.listDocumentsByType('code')) {
    if (!existsSync(filename)) {
      try { db.deleteDocument(filename); logger.info(`Removed stale code: ${filename}`); } catch { /* ignore */ }
    }
  }
}
