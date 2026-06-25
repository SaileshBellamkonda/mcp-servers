import { statSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { VectorDB } from '../vectordb/db.js';
import type { Embedder } from '../embedder/embedder.js';
import { parseMarkdownFile } from './chunk.js';
import { CodeParser } from './code-parser.js';
import { isSupportedExtension } from './languages.js';
import type { CodeSyncResult } from '../core/types.js';
import type { McpLogger } from '../core/logger.js';

export interface IndexerOptions {
  globalExclude?: string[];
  useGitignore?: boolean;
  logger?: McpLogger;
}

interface GitignoreRule {
  baseDir: string;
  patterns: string[];
}

function matchGlob(str: string, pattern: string): boolean {
  const s = str.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');
  const regexStr = p
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\//g, '\x01')
    .replace(/\*\*/g, '\x02')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\x01/g, '(.*\/)?')
    .replace(/\x02/g, '.*');
  return new RegExp(`^${regexStr}$`).test(s);
}

function isExcluded(fullPath: string, rootDir: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = fullPath.replace(/\\/g, '/');
  const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
  const basename = path.basename(fullPath);
  for (const pattern of patterns) {
    const p = pattern.replace(/\\/g, '/');
    if (!p.includes('/') && !p.includes('*') && !p.includes('?') && basename === p) return true;
    if (matchGlob(relPath, p)) return true;
    if (matchGlob(normalized, p)) return true;
  }
  return false;
}

function loadGitignore(dir: string): GitignoreRule | null {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) return null;
  try {
    const lines = readFileSync(gitignorePath, 'utf8').split('\n');
    const patterns = lines
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!'));
    return patterns.length > 0 ? { baseDir: dir, patterns } : null;
  } catch {
    return null;
  }
}

function isExcludedByGitignore(fullPath: string, rules: GitignoreRule[]): boolean {
  if (rules.length === 0) return false;
  const basename = path.basename(fullPath);
  for (const { baseDir, patterns } of rules) {
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    for (const rawPattern of patterns) {
      const isDir = rawPattern.endsWith('/');
      const p = (isDir ? rawPattern.slice(0, -1) : rawPattern).replace(/\\/g, '/');
      if (!p.includes('/') && matchGlob(basename, p)) return true;
      if (matchGlob(relPath, p)) return true;
      if (matchGlob(relPath, `${p}/**`)) return true;
    }
  }
  return false;
}

export class Indexer {
  private readonly db: VectorDB;
  private readonly embedder: Embedder;
  private readonly chunkSize: number;
  private readonly globalExclude: string[];
  private readonly useGitignore: boolean;
  private readonly logger: McpLogger | undefined;
  private codeParser: CodeParser | null = null;

  constructor(db: VectorDB, embedder: Embedder, chunkSize: number, options: IndexerOptions = {}) {
    this.db = db;
    this.embedder = embedder;
    this.chunkSize = chunkSize;
    this.globalExclude = options.globalExclude ?? [];
    this.useGitignore = options.useGitignore ?? false;
    this.logger = options.logger;
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

  async indexCodeDirectory(dir: string, force: boolean, exclude: string[] = []): Promise<CodeSyncResult> {
    const allExclude = [...this.globalExclude, ...exclude];
    const existingDocs = this.db.listDocuments();
    const result: CodeSyncResult = { indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 };

    await this.walkDirectory(dir, async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!isSupportedExtension(ext)) return;

      const stat = statSync(filePath);
      const existingModTime = existingDocs.get(filePath);

      if (existingModTime !== undefined && !force) {
        if (Math.floor(stat.mtimeMs / 1000) === Math.floor(existingModTime.getTime() / 1000)) {
          result.skipped++;
          return;
        }
        result.updated++;
      } else if (existingModTime === undefined) {
        result.added++;
      }

      try {
        await this.indexCodeFile(filePath);
        result.indexed++;
      } catch (err) {
        this.log('warning', `Failed to index ${filePath}: ${String(err)}`);
        result.failed++;
      }
    }, allExclude, dir);

    this.log('info', `Code indexing done: ${String(result.indexed)} indexed, ${String(result.skipped)} skipped, ${String(result.failed)} failed`);
    return result;
  }

  async indexMarkdownDirectory(dir: string, force: boolean, exclude: string[] = []): Promise<CodeSyncResult> {
    const allExclude = [...this.globalExclude, ...exclude];
    const existingDocs = this.db.listDocuments();
    const result: CodeSyncResult = { indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 };

    await this.walkDirectory(dir, async (filePath) => {
      if (path.extname(filePath).toLowerCase() !== '.md') return;

      const stat = statSync(filePath);
      const existingModTime = existingDocs.get(filePath);

      if (existingModTime !== undefined && !force) {
        if (Math.floor(stat.mtimeMs / 1000) === Math.floor(existingModTime.getTime() / 1000)) {
          result.skipped++;
          return;
        }
        result.updated++;
      } else if (existingModTime === undefined) {
        result.added++;
      }

      try {
        await this.indexFile(filePath);
        result.indexed++;
      } catch (err) {
        this.log('warning', `Failed to index ${filePath}: ${String(err)}`);
        result.failed++;
      }
    }, allExclude, dir);

    this.log('info', `Markdown indexing done: ${String(result.indexed)} indexed, ${String(result.skipped)} skipped, ${String(result.failed)} failed`);
    return result;
  }

  private async walkDirectory(
    dir: string,
    handler: (filePath: string) => Promise<void>,
    excludePatterns: string[] = [],
    rootDir: string = dir,
    gitignoreRules: GitignoreRule[] = [],
  ): Promise<void> {
    const rules = this.useGitignore
      ? [...gitignoreRules, ...(loadGitignore(dir) ? [loadGitignore(dir)!] : [])]
      : gitignoreRules;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (isExcluded(fullPath, rootDir, excludePatterns)) continue;
      if (isExcludedByGitignore(fullPath, rules)) continue;

      if (stat.isDirectory()) {
        const skipBuiltin = entry.startsWith('.') || entry === 'node_modules' || entry === 'dist';
        if (!skipBuiltin) {
          await this.walkDirectory(fullPath, handler, excludePatterns, rootDir, rules);
        }
      } else {
        await handler(fullPath);
      }
    }
  }
}
