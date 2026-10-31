import { VectorDB } from '../vectordb/db.ts';
import type { CodeRagConfig } from './types.ts';
import { createStderrLogger, type CodeRagLogger } from './logger.ts';

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
    logger.warning(`Configured embedding dimension ${String(config.embeddingDim)} differs from the stored database dimension ${String(stored)}; keeping the stored dimension ${String(stored)}. Delete the database file to start over with ${String(config.embeddingDim)} dimensions.`);
  }
  if (stored !== null) {
    logger.info(`Using stored embedding dimensions: ${String(stored)}`);
    return stored;
  }
  logger.info(`Using configured embedding dimensions: ${String(config.embeddingDim)}`);
  return config.embeddingDim;
}
