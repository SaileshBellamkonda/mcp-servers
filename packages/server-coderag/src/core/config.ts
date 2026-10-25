import type { CodeRagConfig, GlobConfig } from './types.js';
import { ConfigError } from './types.js';
import {
  DEFAULT_DOCS_INCLUDE,
  DEFAULT_CODE_INCLUDE,
} from './glob-utils.js';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_TOP_K = 5;
const DEFAULT_EMBEDDING_DIM = 768;

function parseSemicolon(raw: string | undefined, defaults: string[]): string[] {
  if (!raw || raw.trim() === '') return defaults;
  return raw.split(';').map((p) => p.trim()).filter(Boolean);
}

export function loadConfigFromEnv(): CodeRagConfig {
  const url = process.env['CODERAG_EMBEDDING_URL'];
  if (!url) {
    throw new ConfigError(
      'CODERAG_EMBEDDING_URL is required. Set it to your OpenAI-compatible embedding endpoint (e.g. http://localhost:11434/v1 for Ollama).'
    );
  }

  const model = process.env['CODERAG_EMBEDDING_MODEL'];
  if (!model) {
    throw new ConfigError(
      'CODERAG_EMBEDDING_MODEL is required. Set it to your embedding model name (e.g. nomic-embed-text for Ollama).'
    );
  }

  const dbPath = process.env['CODERAG_DB_PATH'];
  if (!dbPath) {
    throw new ConfigError(
      'CODERAG_DB_PATH is required. Set it to the path where CodeRAG should store its SQLite database (e.g. /data/coderag.db).'
    );
  }

  const chunkSizeRaw = process.env['CODERAG_CHUNK_SIZE'];
  const topKRaw = process.env['CODERAG_TOP_K'];
  const embeddingDimRaw = process.env['CODERAG_EMBEDDING_DIM'];
  const useGitignoreRaw = process.env['CODERAG_USE_GITIGNORE'];

  const globs: GlobConfig = {
    docsInclude: parseSemicolon(process.env['CODERAG_DOCS_INCLUDE'], DEFAULT_DOCS_INCLUDE),
    docsExclude: parseSemicolon(process.env['CODERAG_DOCS_EXCLUDE'], []),
    codeInclude: parseSemicolon(process.env['CODERAG_CODE_INCLUDE'], DEFAULT_CODE_INCLUDE),
    codeExclude: parseSemicolon(process.env['CODERAG_CODE_EXCLUDE'], []),
  };

  return {
    embedding: {
      url,
      model,
      apiKey: process.env['CODERAG_EMBEDDING_API_KEY'] ?? undefined,
      batchSize: DEFAULT_BATCH_SIZE,
    },
    dbPath,
    globs,
    chunkSize: chunkSizeRaw ? parseInt(chunkSizeRaw, 10) : DEFAULT_CHUNK_SIZE,
    topK: topKRaw ? parseInt(topKRaw, 10) : DEFAULT_TOP_K,
    useGitignore: useGitignoreRaw === undefined ? true : /^(true|1|yes)$/i.test(useGitignoreRaw),
    embeddingDim: embeddingDimRaw ? parseInt(embeddingDimRaw, 10) : DEFAULT_EMBEDDING_DIM,
  };
}

export interface VsCodeConfiguration {
  get(key: string): unknown;
}

export function loadConfigFromVsCode(
  vsConfig: VsCodeConfiguration,
  workspaceFolders: string[]
): CodeRagConfig {
  const url = vsConfig.get('embeddingUrl');
  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new ConfigError(
      'coderag.embeddingUrl is required. Configure it in VS Code settings to point to your OpenAI-compatible embedding endpoint.'
    );
  }

  const model = vsConfig.get('embeddingModel');
  if (!model || typeof model !== 'string' || model.trim() === '') {
    throw new ConfigError(
      'coderag.embeddingModel is required. Configure it in VS Code settings with your embedding model name.'
    );
  }

  const dbPath = vsConfig.get('dbPath');
  if (!dbPath || typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new ConfigError(
      'coderag.dbPath is required. Configure it in VS Code settings with the path to the CodeRAG SQLite database file.'
    );
  }

  const apiKey = vsConfig.get('embeddingApiKey');
  const chunkSize = vsConfig.get('chunkSize');
  const topK = vsConfig.get('topK');
  const embeddingDim = vsConfig.get('embeddingDim');
  const useGitignore = vsConfig.get('useGitignore');

  function parseVsCodeGlob(key: string, defaults: string[]): string[] {
    const val = vsConfig.get(key);
    if (Array.isArray(val)) {
      return (val as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim());
    }
    if (typeof val === 'string' && val.trim() !== '') {
      return val.split(';').map((p) => p.trim()).filter(Boolean);
    }
    return defaults;
  }

  const defaultIncludeDir = workspaceFolders[0] !== undefined ? [`${workspaceFolders[0]}/**/*.{md,mdx}`] : DEFAULT_DOCS_INCLUDE;

  const globs: GlobConfig = {
    docsInclude: parseVsCodeGlob('docsInclude', defaultIncludeDir),
    docsExclude: parseVsCodeGlob('docsExclude', []),
    codeInclude: parseVsCodeGlob('codeInclude', DEFAULT_CODE_INCLUDE),
    codeExclude: parseVsCodeGlob('codeExclude', []),
  };

  return {
    embedding: {
      url: url.trim(),
      model: model.trim(),
      apiKey: apiKey && typeof apiKey === 'string' && apiKey.trim() !== '' ? apiKey.trim() : undefined,
      batchSize: DEFAULT_BATCH_SIZE,
    },
    dbPath: dbPath.trim(),
    globs,
    chunkSize: typeof chunkSize === 'number' && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE,
    topK: typeof topK === 'number' && topK > 0 ? topK : DEFAULT_TOP_K,
    useGitignore: useGitignore !== false,
    embeddingDim: typeof embeddingDim === 'number' && embeddingDim > 0 ? embeddingDim : DEFAULT_EMBEDDING_DIM,
  };
}
