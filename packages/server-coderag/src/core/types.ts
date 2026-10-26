export interface EmbeddingConfig {
  url: string;
  model: string;
  apiKey?: string | undefined;
  batchSize: number;
}

export interface GlobConfig {
  docsInclude: string[];
  docsExclude: string[];
  codeInclude: string[];
  codeExclude: string[];
}

export interface CodeRagConfig {
  embedding: EmbeddingConfig;
  dbPath: string;
  globs: GlobConfig;
  chunkSize: number;
  topK: number;
  useGitignore: boolean;
  embeddingDim: number;
  /** Extra directories the file tools may touch, beyond the cwd/workspace folders and include-glob bases. */
  allowedRoots: string[];
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
  headingPath?: string[] | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
}

export interface DocumentMetadata {
  title?: string | undefined;
  tags: string[];
  docType?: string | undefined;
  domain?: string | undefined;
  project?: string | undefined;
  language?: string | undefined;
  extra: Record<string, unknown>;
}

export interface DocMetadataResult {
  title: string;
  tags: string[];
  docType: string;
  domain: string;
  project: string;
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
  headingPath?: string[] | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  docMetadata?: DocMetadataResult | undefined;
  /** True when the file changed after it was indexed: the lines and text may no longer match the file. */
  stale?: boolean | undefined;
}

export interface SearchFilter {
  directory?: string | undefined;
  filePattern?: string | undefined;
  tags?: string[] | undefined;
  docType?: string | undefined;
  domain?: string | undefined;
  project?: string | undefined;
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
  docType: 'doc' | 'code';
}

export interface CodeSyncResult {
  indexed: number;
  skipped: number;
  failed: number;
  added: number;
  updated: number;
}

export interface SyncStatus {
  inProgress: boolean;
  operation: string | null;
  startedAt: Date | null;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
