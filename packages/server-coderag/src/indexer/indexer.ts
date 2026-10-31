import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.ts';
import type { Embedder } from '../embedder/embedder.ts';
import { chunkSections } from './chunk.ts';
import { CodeParser } from './code-parser.ts';
import { isSupportedExtension } from './languages.ts';
import { createDefaultLoaderRegistry, type LoaderRegistry } from './loaders/index.ts';
import type { CodeSyncResult, DocumentMetadata, MarkdownChunk } from '../core/types.ts';
import type { CodeRagLogger } from '../core/logger.ts';
import { GlobMatcher, type GlobMatcherOptions } from '../core/glob-utils.ts';
import type { PathGuard } from '../core/path-guard.ts';

export interface IndexerOptions {
  docsMatcher?: GlobMatcher;
  codeMatcher?: GlobMatcher;
  globalExclude?: string[];
  useGitignore?: boolean;
  logger?: CodeRagLogger;
  loaders?: LoaderRegistry;
  /** Confines indexing to the allowed roots; files resolving outside them are rejected or skipped. */
  pathGuard?: PathGuard;
  /** Directory whose `node_modules` holds tree-sitter and the grammars (bundled builds). */
  nativeModulesDir?: string | undefined;
}

/**
 * Parsing and SQLite writes are synchronous. Yield to the event loop after this many files so that an
 * in-process host (the VS Code extension host) stays responsive during a large index run.
 */
const FILES_PER_TICK = 5;

/**
 * True when a file's modification time is the one stored with its index entry. Compared to the millisecond, so an
 * edit within the same second as the previous indexing is still noticed.
 */
export function isUnchangedSince(mtime: Date, indexedModifiedAt: Date): boolean {
  return mtime.getTime() === indexedModifiedAt.getTime();
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Text sent to the embedder: document title, heading breadcrumb and tags give the chunk its context. */
function buildDocEmbeddingText(metadata: DocumentMetadata, chunk: MarkdownChunk): string {
  const header: string[] = [];
  if (metadata.title) header.push(metadata.title);
  if (chunk.headingPath && chunk.headingPath.length > 0) header.push(chunk.headingPath.join(' > '));
  if (metadata.tags.length > 0) header.push(`tags: ${metadata.tags.join(', ')}`);
  return header.length > 0 ? `${header.join('\n')}\n\n${chunk.content}` : chunk.content;
}

export class Indexer {
  private readonly db: VectorDB;
  private readonly embedder: Embedder;
  private readonly chunkSize: number;
  private readonly logger: CodeRagLogger | undefined;
  private readonly docsMatcher: GlobMatcher | undefined;
  private readonly codeMatcher: GlobMatcher | undefined;
  private readonly globalExclude: string[];
  private readonly useGitignore: boolean;
  private readonly loaders: LoaderRegistry;
  private readonly pathGuard: PathGuard | undefined;
  private readonly nativeModulesDir: string | undefined;
  private codeParser: CodeParser | null = null;

  constructor(db: VectorDB, embedder: Embedder, chunkSize: number, options: IndexerOptions = {}) {
    this.db = db;
    this.embedder = embedder;
    this.chunkSize = chunkSize;
    this.logger = options.logger;
    this.docsMatcher = options.docsMatcher;
    this.codeMatcher = options.codeMatcher;
    this.globalExclude = options.globalExclude ?? [];
    this.useGitignore = options.useGitignore ?? false;
    this.loaders = options.loaders ?? createDefaultLoaderRegistry();
    this.pathGuard = options.pathGuard;
    this.nativeModulesDir = options.nativeModulesDir;
  }

  private matcherOptions(): GlobMatcherOptions {
    return {
      warn: (msg) => { this.log('warning', msg); },
      ...(this.pathGuard ? { pathGuard: this.pathGuard } : {}),
    };
  }

  private log(level: 'info' | 'warning', msg: string): void {
    if (level === 'warning') this.logger?.warning(msg);
    else this.logger?.info(msg);
  }

  private getCodeParser(): CodeParser {
    this.codeParser ??= new CodeParser({ nativeModulesDir: this.nativeModulesDir, warn: (msg) => { this.log('warning', msg); } });
    return this.codeParser;
  }

  close(): void {
    this.codeParser?.close();
    this.codeParser = null;
  }

  isDocExcluded(filePath: string): boolean {
    return this.docsMatcher?.isExcluded(filePath) ?? false;
  }

  isCodeExcluded(filePath: string): boolean {
    return this.codeMatcher?.isExcluded(filePath) ?? false;
  }

  /** True when a registered document loader handles this file's extension. */
  isDocumentFile(filePath: string): boolean {
    return this.loaders.isSupported(filePath);
  }

  async indexFile(filePath: string): Promise<void> {
    const readPath = this.pathGuard?.assertAllowedReal(filePath) ?? filePath;
    this.log('info', `Indexing markdown: ${filePath}`);
    const loader = this.loaders.getForFile(filePath);
    if (!loader) {
      throw new Error(`Unsupported document type: ${path.extname(filePath).toLowerCase()}`);
    }

    const stat = statSync(readPath);
    const doc = loader.load(filePath, readFileSync(readPath, 'utf8'));
    for (const warning of doc.warnings ?? []) this.log('warning', `${filePath}: ${warning}`);
    const chunks = chunkSections(doc.sections, this.chunkSize);

    if (chunks.length === 0) {
      try { this.db.deleteDocument(filePath); } catch { /* not previously indexed */ }
      this.log('warning', `No chunks from ${filePath} (empty?)`);
      return;
    }

    const texts = chunks.map((c) => buildDocEmbeddingText(doc.metadata, c));
    const embeddings = await this.embedder.embedBatch(texts);
    this.db.insertDocument(filePath, stat.mtime, chunks, embeddings, doc.metadata);
    this.log('info', `Indexed ${filePath} (${String(chunks.length)} chunks)`);
  }

  async indexCodeFile(filePath: string): Promise<void> {
    const readPath = this.pathGuard?.assertAllowedReal(filePath) ?? filePath;
    this.log('info', `Indexing code: ${filePath}`);
    const stat = statSync(readPath);
    const parser = this.getCodeParser();
    const { chunks, relations } = parser.parseFileWithRelations(filePath, readPath);

    if (chunks.length === 0) {
      // Recorded with no chunks, so a file without symbols is not parsed again by every scan.
      this.db.insertCodeDocument(filePath, stat.mtime, [], []);
      this.log('info', `No symbols in ${filePath}`);
      return;
    }

    const texts = chunks.map((c) => CodeParser.getEmbeddingText(c));
    const embeddings = await this.embedder.embedBatch(texts);
    this.db.insertCodeDocument(filePath, stat.mtime, chunks, embeddings, relations);
    this.log('info', `Indexed ${filePath} (${String(chunks.length)} symbols)`);
  }

  /**
   * Fills the relations (imports, inheritance, calls) of code files that are already indexed, for an index written
   * before relations were recorded. The files are parsed again but not embedded, and their chunks and vectors are left
   * as they are. A file that changed since it was indexed is skipped: the normal scan re-indexes it with its relations.
   */
  async backfillRelations(): Promise<{ filled: number; skipped: number; failed: number }> {
    const result = { filled: 0, skipped: 0, failed: 0 };
    for (const [index, [filePath]] of [...this.db.listDocumentsByType('code')].entries()) {
      if (index > 0 && index % FILES_PER_TICK === 0) await yieldToEventLoop();
      try {
        if (!existsSync(filePath) || (this.pathGuard && !this.pathGuard.isAllowed(filePath))) {
          result.skipped++;
          continue;
        }
        const readPath = this.pathGuard?.assertAllowedReal(filePath) ?? filePath;
        const { chunks, relations } = this.getCodeParser().parseFileWithRelations(filePath, readPath);
        if (this.db.replaceRelations(filePath, chunks, relations)) result.filled++;
        else result.skipped++;
      } catch (err) {
        this.log('warning', `Failed to read the relations of ${filePath}: ${String(err)}`);
        result.failed++;
      }
    }
    await this.db.resolvePendingRelations({ yieldToEventLoop });
    this.log('info', `Relations filled for ${String(result.filled)} code files (${String(result.skipped)} skipped, ${String(result.failed)} failed)`);
    return result;
  }

  async scanDocs(force = false): Promise<CodeSyncResult> {
    if (!this.docsMatcher) return { indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 };
    const files = this.docsMatcher.findFiles().filter((f) => this.loaders.isSupported(f));
    return this.indexFileList(files, 'doc', force);
  }

  async scanCode(force = false): Promise<CodeSyncResult> {
    if (!this.codeMatcher) return { indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 };
    const files = this.codeMatcher.findFiles().filter((f) => isSupportedExtension(path.extname(f).toLowerCase()));
    return this.indexFileList(files, 'code', force);
  }

  private async indexFileList(
    files: string[],
    type: 'doc' | 'code',
    force: boolean,
  ): Promise<CodeSyncResult> {
    const existingDocs = type === 'doc'
      ? this.db.listDocumentsByType('doc')
      : this.db.listDocumentsByType('code');
    const result: CodeSyncResult = { indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 };

    for (const [index, filePath] of files.entries()) {
      if (index > 0 && index % FILES_PER_TICK === 0) await yieldToEventLoop();
      if (this.pathGuard && !this.pathGuard.isAllowed(filePath)) {
        this.log('warning', `Skipping ${filePath}: it resolves outside the allowed roots (set CODERAG_ALLOWED_ROOTS to allow it)`);
        result.skipped++;
        continue;
      }
      try {
        const stat = statSync(filePath);
        const existingModTime = existingDocs.get(filePath);

        if (existingModTime !== undefined && !force) {
          if (isUnchangedSince(stat.mtime, existingModTime)) {
            result.skipped++;
            continue;
          }
          result.updated++;
        } else if (existingModTime === undefined) {
          result.added++;
        }

        if (type === 'doc') {
          await this.indexFile(filePath);
        } else {
          await this.indexCodeFile(filePath);
        }
        result.indexed++;
      } catch (err) {
        this.log('warning', `Failed to index ${filePath}: ${String(err)}`);
        result.failed++;
      }
    }

    // Files indexed or removed during this scan can change what other files' calls and imports point to.
    if (type === 'code') await this.db.resolvePendingRelations({ yieldToEventLoop });

    const label = type === 'doc' ? 'Markdown' : 'Code';
    this.log('info', `${label} indexing done: ${String(result.indexed)} indexed, ${String(result.skipped)} skipped, ${String(result.failed)} failed`);
    return result;
  }

  // Legacy directory-based methods kept for tool compatibility
  async indexCodeDirectory(dir: string, force: boolean, exclude: string[] = []): Promise<CodeSyncResult> {
    const matcher = new GlobMatcher(
      [`${dir.replace(/\\/g, '/')}/**/*`],
      [...this.globalExclude, ...exclude],
      dir,
      this.useGitignore,
      this.matcherOptions(),
    );
    const files = matcher.findFiles().filter((f) => isSupportedExtension(path.extname(f).toLowerCase()));
    return this.indexFileList(files, 'code', force);
  }

  async indexMarkdownDirectory(dir: string, force: boolean, exclude: string[] = []): Promise<CodeSyncResult> {
    const matcher = new GlobMatcher(
      [`${dir.replace(/\\/g, '/')}/${this.loaders.globPattern()}`],
      [...this.globalExclude, ...exclude],
      dir,
      this.useGitignore,
      this.matcherOptions(),
    );
    const files = matcher.findFiles();
    return this.indexFileList(files, 'doc', force);
  }
}
