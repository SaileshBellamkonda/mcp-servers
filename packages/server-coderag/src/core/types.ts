export interface EmbeddingConfig {
  url: string;
  model: string;
  apiKey?: string | undefined;
  batchSize: number;
}

export interface CodeRagConfig {
  embedding: EmbeddingConfig;
  dbPath: string;
  documentsDir: string;
  chunkSize: number;
  topK: number;
  exclude: string[];
  useGitignore: boolean;
  /** Pre-configured embedding dimension. When set, skips the detectDimensions() API call at startup. */
  embeddingDim?: number | undefined;
}

export type SymbolType = 'function' | 'method' | 'class' | 'struct' | 'interface';

export interface CodeChunk {
  content: string;
  position: number;
  symbolName: string;
  symbolType: SymbolType;
  language: string;
  startLine: number;
  endLine: number;
  parentSymbol: string;
  signature: string;
}

export interface MarkdownChunk {
  content: string;
  position: number;
}

export interface CodeMetadataResult {
  symbolName: string;
  symbolType: string;
  language: string;
  startLine: number;
  endLine: number;
  parentSymbol: string;
  signature: string;
}

export interface SearchResult {
  document: string;
  chunk: string;
  similarity: number;
  position: number;
  metadata?: CodeMetadataResult | undefined;
}

export interface SearchFilter {
  directory?: string | undefined;
  filePattern?: string | undefined;
}

export interface CodeRelation {
  id?: number | undefined;
  sourceChunkId: number;
  targetChunkId?: number | undefined;
  relationType: string;
  targetName: string;
  targetFile: string;
  confidence: number;
  sourceName?: string | undefined;
  sourceFile?: string | undefined;
}

export interface DocumentRecord {
  filename: string;
  modifiedAt: Date;
}

export interface CodeSyncResult {
  indexed: number;
  skipped: number;
  failed: number;
  added: number;
  updated: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
