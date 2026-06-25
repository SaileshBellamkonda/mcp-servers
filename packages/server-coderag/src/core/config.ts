import type { CodeRagConfig } from './types.js';
import { ConfigError } from './types.js';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_TOP_K = 5;
const DEFAULT_DB_PATH = './coderag.db';
const DEFAULT_DOCUMENTS_DIR = './documents';

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

  const chunkSizeRaw = process.env['CODERAG_CHUNK_SIZE'];
  const topKRaw = process.env['CODERAG_TOP_K'];
  const embeddingDimRaw = process.env['CODERAG_EMBEDDING_DIM'];

  const excludeRaw = process.env['CODERAG_EXCLUDE'];
  const useGitignoreRaw = process.env['CODERAG_USE_GITIGNORE'];

  return {
    embedding: {
      url,
      model,
      apiKey: process.env['CODERAG_EMBEDDING_API_KEY'] ?? undefined,
      batchSize: DEFAULT_BATCH_SIZE,
    },
    dbPath: process.env['CODERAG_DB_PATH'] ?? DEFAULT_DB_PATH,
    documentsDir: process.env['CODERAG_DOCUMENTS_DIR'] ?? DEFAULT_DOCUMENTS_DIR,
    chunkSize: chunkSizeRaw ? parseInt(chunkSizeRaw, 10) : DEFAULT_CHUNK_SIZE,
    topK: topKRaw ? parseInt(topKRaw, 10) : DEFAULT_TOP_K,
    exclude: excludeRaw ? excludeRaw.split(',').map((p) => p.trim()).filter(Boolean) : [],
    useGitignore: /^(true|1|yes)$/i.test(useGitignoreRaw ?? ''),
    embeddingDim: embeddingDimRaw ? parseInt(embeddingDimRaw, 10) : undefined,
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

  const apiKey = vsConfig.get('embeddingApiKey');
  const dbPath = vsConfig.get('dbPath');
  const documentsDir = vsConfig.get('documentsDir');
  const chunkSize = vsConfig.get('chunkSize');
  const topK = vsConfig.get('topK');
  const embeddingDim = vsConfig.get('embeddingDim');

  const resolvedDocumentsDir =
    documentsDir && typeof documentsDir === 'string' && documentsDir.trim() !== ''
      ? documentsDir
      : (workspaceFolders[0] ?? DEFAULT_DOCUMENTS_DIR);

  const exclude = vsConfig.get('exclude');
  const useGitignore = vsConfig.get('useGitignore');

  const resolvedExclude: string[] = Array.isArray(exclude)
    ? (exclude as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim())
    : typeof exclude === 'string' && exclude.trim() !== ''
      ? exclude.split(',').map((p) => p.trim()).filter(Boolean)
      : [];

  return {
    embedding: {
      url: url.trim(),
      model: model.trim(),
      apiKey: apiKey && typeof apiKey === 'string' && apiKey.trim() !== '' ? apiKey.trim() : undefined,
      batchSize: DEFAULT_BATCH_SIZE,
    },
    dbPath: dbPath && typeof dbPath === 'string' && dbPath.trim() !== '' ? dbPath.trim() : DEFAULT_DB_PATH,
    documentsDir: resolvedDocumentsDir,
    chunkSize: typeof chunkSize === 'number' && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE,
    topK: typeof topK === 'number' && topK > 0 ? topK : DEFAULT_TOP_K,
    exclude: resolvedExclude,
    useGitignore: useGitignore === true,
    embeddingDim: typeof embeddingDim === 'number' && embeddingDim > 0 ? embeddingDim : undefined,
  };
}
