import { existsSync } from 'node:fs';
import type { VectorDB } from '../vectordb/db.js';
import type { Indexer } from './indexer.js';
import type { CodeRagLogger } from '../core/logger.js';
import type { GlobConfig } from '../core/types.js';
import { GlobMatcher } from '../core/glob-utils.js';
import { SyncManager } from './sync-manager.js';
import { CODE_PARSER_VERSION } from './code-parser.js';

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

    logger.info(`Startup sync: rules_changed=${String(rulesChanged)}, no_docs=${String(noDocsIndexed)}, no_code=${String(noCodeIndexed)}, docs_reindex=${String(docsReindexRequired)}, code_parser_stale=${String(codeParserStale)}`);

    const docsMatcher = new GlobMatcher(currentGlobs.docsInclude, currentGlobs.docsExclude, cwd, config.useGitignore);
    const codeMatcher = new GlobMatcher(currentGlobs.codeInclude, currentGlobs.codeExclude, cwd, config.useGitignore);

    if (rulesChanged && storedRules !== null) {
      // Rules tightened: prune DB entries that are now excluded or no longer included
      logger.info('Rules changed — pruning excluded documents...');
      pruneExcluded(db, docsMatcher, codeMatcher, logger);
    }

    if (rulesChanged || noDocsIndexed || docsReindexRequired) {
      logger.info(docsReindexRequired ? 'Scanning docs (forced re-index)...' : 'Scanning docs...');
      const docsResult = await indexer.scanDocs(docsReindexRequired);
      logger.info(`Docs scan: ${String(docsResult.indexed)} indexed, ${String(docsResult.skipped)} skipped, ${String(docsResult.failed)} failed`);
      db.setLastSyncAt('docs', new Date());
      if (docsReindexRequired && docsResult.failed === 0) db.clearDocsReindexRequired();
    }

    if (rulesChanged || noCodeIndexed || codeParserStale) {
      logger.info(codeParserStale ? 'Scanning code (parser version changed, forced re-parse)...' : 'Scanning code...');
      const codeResult = await indexer.scanCode(codeParserStale);
      logger.info(`Code scan: ${String(codeResult.indexed)} indexed, ${String(codeResult.skipped)} skipped, ${String(codeResult.failed)} failed`);
      db.setLastSyncAt('code', new Date());
      // A failed forced scan leaves the marker unset, so the next startup tries again.
      if (!codeParserStale || codeResult.failed === 0) db.setCodeParserVersion(CODE_PARSER_VERSION);
    }

    if (!rulesChanged && !noDocsIndexed) {
      // Incremental: remove stale docs entries
      await removeStaleDocs(db, logger);
    }

    if (!rulesChanged && !noCodeIndexed) {
      await removeStaleCode(db, logger);
    }

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
