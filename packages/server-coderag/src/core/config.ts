import { parseBool, parseList } from '@mcp-servers/common';
import type { CodeRagConfig, GlobConfig } from './types.ts';
import { ConfigError } from './types.ts';
import {
  DEFAULT_DOCS_INCLUDE,
  DEFAULT_CODE_INCLUDE,
  resolveToAbsolute,
} from './glob-utils.ts';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_TOP_K = 5;
const DEFAULT_EMBEDDING_DIM = 768;
/** Longest text sent to the embedding endpoint, in characters; longer chunks are cut for embedding only. 0 disables the limit. */
export const DEFAULT_EMBED_MAX_CHARS = 6000;

/** Environment variables as read by {@link loadConfigFromEnv}; `process.env` satisfies it. */
export type Env = Readonly<Record<string, string | undefined>>;

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Refuses to send an API key in clear text: with a key configured the embedding URL must be `https:`, or
 * `http:` to the local machine. Unparseable URLs are left for the embedder to reject. The message names the
 * settings and never includes the key.
 */
export function assertSecureEmbeddingUrl(
  url: string,
  apiKey: string | undefined,
  urlSetting: string,
  keySetting: string,
): void {
  if (apiKey === undefined || apiKey === '') return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' || isLoopbackHost(parsed.hostname)) return;
  throw new ConfigError(
    `${urlSetting} uses plain http:// to ${parsed.hostname}, so the API key (${keySetting}) would be sent unencrypted. ` +
      'Use an https:// URL, point at localhost, or remove the API key.',
  );
}

function parseEmbedMaxChars(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_EMBED_MAX_CHARS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`CODERAG_EMBED_MAX_CHARS must be a whole number of characters (0 disables the limit), got "${raw}".`);
  }
  return parseInt(raw.trim(), 10);
}

/** Builds the configuration from `env` only; it never reads or writes `process.env` itself. */
export function loadConfigFromEnv(env: Env = process.env): CodeRagConfig {
  const url = env['CODERAG_EMBEDDING_URL'];
  if (!url) {
    throw new ConfigError(
      'CODERAG_EMBEDDING_URL is required. Set it to your OpenAI-compatible embedding endpoint (e.g. http://localhost:11434/v1 for Ollama).'
    );
  }

  const model = env['CODERAG_EMBEDDING_MODEL'];
  if (!model) {
    throw new ConfigError(
      'CODERAG_EMBEDDING_MODEL is required. Set it to your embedding model name (e.g. nomic-embed-text for Ollama).'
    );
  }

  const dbPath = env['CODERAG_DB_PATH'];
  if (!dbPath) {
    throw new ConfigError(
      'CODERAG_DB_PATH is required. Set it to the path where CodeRAG should store its SQLite database (e.g. /data/coderag.db).'
    );
  }

  assertSecureEmbeddingUrl(url, env['CODERAG_EMBEDDING_API_KEY'], 'CODERAG_EMBEDDING_URL', 'CODERAG_EMBEDDING_API_KEY');

  const chunkSizeRaw = env['CODERAG_CHUNK_SIZE'];
  const topKRaw = env['CODERAG_TOP_K'];
  const embeddingDimRaw = env['CODERAG_EMBEDDING_DIM'];
  const useGitignoreRaw = env['CODERAG_USE_GITIGNORE'];

  const globs: GlobConfig = {
    docsInclude: parseList(env['CODERAG_DOCS_INCLUDE'], DEFAULT_DOCS_INCLUDE),
    docsExclude: parseList(env['CODERAG_DOCS_EXCLUDE'], []),
    codeInclude: parseList(env['CODERAG_CODE_INCLUDE'], DEFAULT_CODE_INCLUDE),
    codeExclude: parseList(env['CODERAG_CODE_EXCLUDE'], []),
  };

  return {
    embedding: {
      url,
      model,
      apiKey: env['CODERAG_EMBEDDING_API_KEY'] ?? undefined,
      batchSize: DEFAULT_BATCH_SIZE,
      maxChars: parseEmbedMaxChars(env['CODERAG_EMBED_MAX_CHARS']),
    },
    dbPath,
    globs,
    chunkSize: chunkSizeRaw ? parseInt(chunkSizeRaw, 10) : DEFAULT_CHUNK_SIZE,
    topK: topKRaw ? parseInt(topKRaw, 10) : DEFAULT_TOP_K,
    useGitignore: parseBool(useGitignoreRaw, true),
    embeddingDim: embeddingDimRaw ? parseInt(embeddingDimRaw, 10) : DEFAULT_EMBEDDING_DIM,
    allowedRoots: parseList(env['CODERAG_ALLOWED_ROOTS'], []),
  };
}

/**
 * With several workspace folders a relative pattern would only match under the first one, so it is
 * expanded into one absolute pattern per folder. Absolute patterns are kept as they are.
 */
function expandPerFolder(patterns: string[], workspaceFolders: string[]): string[] {
  if (workspaceFolders.length < 2) return patterns;
  const expanded = new Set<string>();
  for (const pattern of patterns) {
    for (const folder of workspaceFolders) expanded.add(resolveToAbsolute(pattern, folder));
  }
  return [...expanded];
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
      'mcpServers.coderag.embeddingUrl is required. Configure it in VS Code settings to point to your OpenAI-compatible embedding endpoint.'
    );
  }

  const model = vsConfig.get('embeddingModel');
  if (!model || typeof model !== 'string' || model.trim() === '') {
    throw new ConfigError(
      'mcpServers.coderag.embeddingModel is required. Configure it in VS Code settings with your embedding model name.'
    );
  }

  const dbPath = vsConfig.get('dbPath');
  if (!dbPath || typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new ConfigError(
      'The CodeRAG database path (dbPath) is missing. The VS Code extension supplies it from its storage folder; ' +
        'an application embedding CodeRAG must pass dbPath in the configuration it hands to activateCodeRagServer.'
    );
  }

  const apiKey = vsConfig.get('embeddingApiKey');
  assertSecureEmbeddingUrl(
    url.trim(),
    typeof apiKey === 'string' ? apiKey.trim() : undefined,
    'mcpServers.coderag.embeddingUrl',
    'the embedding API key',
  );
  const chunkSize = vsConfig.get('chunkSize');
  const topK = vsConfig.get('topK');
  const embeddingDim = vsConfig.get('embeddingDim');
  const useGitignore = vsConfig.get('useGitignore');
  const embedMaxChars = vsConfig.get('embedMaxChars');

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

  const defaultIncludeDir = workspaceFolders.length > 0 ? workspaceFolders.map((folder) => `${folder}/**/*.{md,mdx}`) : DEFAULT_DOCS_INCLUDE;

  const globs: GlobConfig = {
    docsInclude: expandPerFolder(parseVsCodeGlob('docsInclude', defaultIncludeDir), workspaceFolders),
    docsExclude: expandPerFolder(parseVsCodeGlob('docsExclude', []), workspaceFolders),
    codeInclude: expandPerFolder(parseVsCodeGlob('codeInclude', DEFAULT_CODE_INCLUDE), workspaceFolders),
    codeExclude: expandPerFolder(parseVsCodeGlob('codeExclude', []), workspaceFolders),
  };

  return {
    embedding: {
      url: url.trim(),
      model: model.trim(),
      apiKey: apiKey && typeof apiKey === 'string' && apiKey.trim() !== '' ? apiKey.trim() : undefined,
      batchSize: DEFAULT_BATCH_SIZE,
      maxChars: typeof embedMaxChars === 'number' && Number.isInteger(embedMaxChars) && embedMaxChars >= 0 ? embedMaxChars : DEFAULT_EMBED_MAX_CHARS,
    },
    dbPath: dbPath.trim(),
    globs,
    chunkSize: typeof chunkSize === 'number' && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE,
    topK: typeof topK === 'number' && topK > 0 ? topK : DEFAULT_TOP_K,
    useGitignore: useGitignore !== false,
    embeddingDim: typeof embeddingDim === 'number' && embeddingDim > 0 ? embeddingDim : DEFAULT_EMBEDDING_DIM,
    allowedRoots: parseVsCodeGlob('allowedRoots', []),
  };
}
