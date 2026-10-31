import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VectorDB } from '../../../src/vectordb/db.ts';
import type { Indexer } from '../../../src/indexer/indexer.ts';
import type { SyncManager } from '../../../src/indexer/sync-manager.ts';
import type { GlobMatcher } from '../../../src/core/glob-utils.ts';
import type { McpLogger } from '@mcp-servers/common';

vi.mock('node:fs', () => ({
  watch: vi.fn(),
  existsSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { CodeRagWatcher } from '../../../src/indexer/watcher.ts';

/** `handleChange` is private; the tests drive it directly instead of waiting for file-system events. */
interface WatcherInternals {
  handleChange(filePath: string): Promise<void>;
}

const mockExistsSync = vi.mocked(fs.existsSync);

describe('CodeRagWatcher document types', () => {
  let watcher: CodeRagWatcher;
  let indexer: Indexer;
  let isDocumentFile: ReturnType<typeof vi.fn>;
  let docsMatcher: GlobMatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    isDocumentFile = vi.fn((p: string) => p.endsWith('.mdx'));
    indexer = {
      indexFile: vi.fn().mockResolvedValue(undefined),
      indexCodeFile: vi.fn().mockResolvedValue(undefined),
      isDocumentFile,
    } as unknown as Indexer;
    docsMatcher = { isIncluded: vi.fn().mockReturnValue(true) } as unknown as GlobMatcher;
    watcher = new CodeRagWatcher(
      { deleteDocument: vi.fn() } as unknown as VectorDB,
      indexer,
      { inProgress: false } as unknown as SyncManager,
      docsMatcher,
      { isIncluded: vi.fn().mockReturnValue(true) } as unknown as GlobMatcher,
      { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as McpLogger,
      0,
    );
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    watcher.close();
  });

  it('indexes a file the indexer recognises as a document, such as .mdx', async () => {
    await (watcher as unknown as WatcherInternals).handleChange('/d/page.mdx');
    expect(isDocumentFile).toHaveBeenCalledWith('/d/page.mdx');
    expect(indexer.indexFile).toHaveBeenCalledWith('/d/page.mdx');
  });

  it('ignores a file the indexer does not recognise as a document, even if it ends in .md', async () => {
    await (watcher as unknown as WatcherInternals).handleChange('/d/notes.md');
    expect(indexer.indexFile).not.toHaveBeenCalled();
    expect(indexer.indexCodeFile).not.toHaveBeenCalled();
  });

  it('still honours the docs include/exclude matcher', async () => {
    vi.mocked(docsMatcher.isIncluded).mockReturnValue(false);
    await (watcher as unknown as WatcherInternals).handleChange('/d/page.mdx');
    expect(indexer.indexFile).not.toHaveBeenCalled();
  });
});
