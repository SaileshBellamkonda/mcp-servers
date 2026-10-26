import { VectorDB } from '../vectordb/db.js';
import type { CodeRagConfig } from './types.js';
import { createStderrLogger, type CodeRagLogger } from './logger.js';

/**
 * Picks the embedding dimensions to open the database with: the stored value when the database
 * already has one (warning when the configured value differs), otherwise the configured value.
 */
export function resolveDimensions(
  config: Pick<CodeRagConfig, 'dbPath' | 'embeddingDim'>,
  logger: CodeRagLogger = createStderrLogger(),
): number {
  const stored = VectorDB.readStoredDimensions(config.dbPath);
  if (stored !== null && stored !== config.embeddingDim) {
    logger.warning(`Embedding dimension changed (${String(stored)} → ${String(config.embeddingDim)}). Vectors will be reset and a full re-index will run on startup.`);
  }
  if (stored !== null) {
    logger.info(`Using stored embedding dimensions: ${String(stored)}`);
    return stored;
  }
  logger.info(`Using configured embedding dimensions: ${String(config.embeddingDim)}`);
  return config.embeddingDim;
}
