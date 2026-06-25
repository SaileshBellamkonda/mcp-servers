import { statSync } from 'node:fs';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import { parseMarkdownFile } from './chunk.js';
import { CodeParser } from './code-parser.js';
import { isSupportedExtension } from './languages.js';
import type { CodeSyncResult } from '../core/types.js';
import type { McpLogger } from '../core/logger.js';
import { GlobMatcher } from '../core/glob-utils.js';

export interface IndexerOptions {
  docsMatcher?: GlobMatcher;
  codeMatcher?: GlobMatcher;
  globalExclude?: string[];
  useGitignore?: boolean;
  logger?: McpLogger;
}

export class Indexer {
  private readonly db: VectorDB;
  private readonly embedder: Embedder;
  private readonly chunkSize: number;
  private readonly logger: McpLogger | undefined;
  private readonly docsMatcher: GlobMatcher | undefined;
  private readonly codeMatcher: GlobMatcher | undefined;
  private readonly globalExclude: string[];
  private readonly useGitignore: boolean;
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
  }

  private log(level: 'info' | 'warning', msg: string): void {
    if (this.logger) {
      if (level === 'warning') this.logger.warning(msg);
      else this.logger.info(msg);
    } else {
      process.stderr.write(`[${level === 'warning' ? 'WARN' : 'INFO'}] ${msg}\n`);
    }
  }

  private getCodeParser(): CodeParser {
    this.codeParser ??= new CodeParser();
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

  async indexFile(filePath: string): Promise<void> {
    this.log('info', `Indexing markdown: ${filePath}`);
    const stat = statSync(filePath);
    const chunks = parseMarkdownFile(filePath, this.chunkSize);

    if (chunks.length === 0) {
      this.log('warning', `No chunks from ${filePath} (empty?)`);
      return;
    }

    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embedder.embedBatch(texts);
    this.db.insertDocument(filePath, stat.mtime, chunks, embeddings);
    this.log('info', `Indexed ${filePath} (${String(chunks.length)} chunks)`);
  }

  async indexCodeFile(filePath: string): Promise<void> {
    this.log('info', `Indexing code: ${filePath}`);
    const stat = statSync(filePath);
    const parser = this.getCodeParser();
    const chunks = parser.parseFile(filePath);

    if (chunks.length === 0) {
      this.log('warning', `No symbols from ${filePath}`);
      return;
    }

    const texts = chunks.map((c) => CodeParser.getEmbeddingText(c));
    const embeddings = await this.embedder.embedBatch(texts);
    this.db.insertCodeDocument(filePath, stat.mtime, chunks, embeddings);
    this.log('info', `Indexed ${filePath} (${String(chunks.length)} symbols)`);
  }

  async scanDocs(force = false): Promise<CodeSyncResult> {
    if (!this.docsMatcher) return { indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 };
    const files = this.docsMatcher.findFiles();
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

    for (const filePath of files) {
      try {
        const stat = statSync(filePath);
        const existingModTime = existingDocs.get(filePath);

        if (existingModTime !== undefined && !force) {
          if (Math.floor(stat.mtimeMs / 1000) === Math.floor(existingModTime.getTime() / 1000)) {
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
    );
    const files = matcher.findFiles().filter((f) => isSupportedExtension(path.extname(f).toLowerCase()));
    return this.indexFileList(files, 'code', force);
  }

  async indexMarkdownDirectory(dir: string, force: boolean, exclude: string[] = []): Promise<CodeSyncResult> {
    const matcher = new GlobMatcher(
      [`${dir.replace(/\\/g, '/')}/**/*.md`],
      [...this.globalExclude, ...exclude],
      dir,
      this.useGitignore,
    );
    const files = matcher.findFiles();
    return this.indexFileList(files, 'doc', force);
  }
}
