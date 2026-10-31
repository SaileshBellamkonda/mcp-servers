import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveDimensions } from '../../../src/core/dimensions.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { CodeRagConfig } from '../../../src/core/types.js';

type LogMock = Mock<(data: unknown) => void>;

function logger(): { info: LogMock; warning: LogMock; error: LogMock; debug: LogMock } {
  return { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('resolveDimensions', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-dims-'));
    dbPath = path.join(dir, 'index.db');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const config = (embeddingDim: number): Pick<CodeRagConfig, 'dbPath' | 'embeddingDim'> => ({ dbPath, embeddingDim });

  it('uses the configured dimensions when no database exists yet', () => {
    const log = logger();
    expect(resolveDimensions(config(8), log)).toBe(8);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('configured embedding dimensions: 8'));
    expect(log.warning).not.toHaveBeenCalled();
  });

  it('uses the stored dimensions without a warning when they match', () => {
    VectorDB.open(dbPath, 8).close();
    const log = logger();
    expect(resolveDimensions(config(8), log)).toBe(8);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('stored embedding dimensions: 8'));
    expect(log.warning).not.toHaveBeenCalled();
  });

  it('warns when the configured dimensions differ from the stored ones', () => {
    VectorDB.open(dbPath, 8).close();
    const log = logger();
    expect(resolveDimensions(config(16), log)).toBe(8);
    const warning = String(log.warning.mock.calls[0]?.[0]);
    expect(warning).toMatch(/16.*differs from the stored.*8/);
    expect(warning).toMatch(/keeping the stored dimension 8/i);
    expect(warning).toMatch(/delete the database/i);
    expect(warning).not.toMatch(/reset|re-index will run/i);
  });
});
