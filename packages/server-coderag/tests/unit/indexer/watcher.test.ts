import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';
import type { VectorDB } from '../../../src/vectordb/db.js';
import type { Indexer } from '../../../src/indexer/indexer.js';
import type { SyncManager } from '../../../src/indexer/sync-manager.js';
import type { GlobMatcher } from '../../../src/core/glob-utils.js';
import type { McpLogger } from '@mcp-servers/common';

vi.mock('node:fs', () => ({
  watch: vi.fn(),
  existsSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { CodeRagWatcher } from '../../../src/indexer/watcher.js';

const mockWatch = vi.mocked(fs.watch);
const mockExistsSync = vi.mocked(fs.existsSync);

function createFakeWatcher(): FSWatcher & { triggerCallback: (event: string, filename: string | null) => void } {
  let capturedCallback: ((event: string, filename: string | null) => void) | undefined;

  const fakeWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
    triggerCallback: (event: string, filename: string | null) => {
      if (capturedCallback) capturedCallback(event, filename);
    },
  };

  // Capture the callback when watch() is called
  mockWatch.mockImplementation((_dir: unknown, _opts: unknown, callback: unknown) => {
    capturedCallback = callback as (event: string, filename: string | null) => void;
    return fakeWatcher as unknown as FSWatcher;
  });

  return fakeWatcher as FSWatcher & { triggerCallback: (event: string, filename: string | null) => void };
}

describe('CodeRagWatcher', () => {
  let watcher: CodeRagWatcher;
  let mockDb: VectorDB;
  let mockIndexer: Indexer;
  let mockSyncManager: { inProgress: boolean };
  let mockDocsMatcher: GlobMatcher;
  let mockCodeMatcher: GlobMatcher;
  let mockLogger: McpLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = { deleteDocument: vi.fn() } as unknown as VectorDB;
    mockIndexer = {
      indexFile: vi.fn().mockResolvedValue(undefined),
      indexCodeFile: vi.fn().mockResolvedValue(undefined),
      isDocumentFile: vi.fn((p: string) => /\.(md|mdx|markdown)$/i.test(p)),
    } as unknown as Indexer;
    mockSyncManager = { inProgress: false };
    mockDocsMatcher = { isIncluded: vi.fn().mockReturnValue(true) } as unknown as GlobMatcher;
    mockCodeMatcher = { isIncluded: vi.fn().mockReturnValue(true) } as unknown as GlobMatcher;
    mockLogger = {
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as McpLogger;

    watcher = new CodeRagWatcher(
      mockDb,
      mockIndexer,
      mockSyncManager as unknown as SyncManager,
      mockDocsMatcher,
      mockCodeMatcher,
      mockLogger,
      0, // debounceMs = 0 for instant execution in tests
    );
  });

  afterEach(() => {
    watcher.close();
  });

  // ─── start() ───────────────────────────────────────────────────────────────

  describe('start()', () => {
    it('skips directories that do not exist', () => {
      mockExistsSync.mockReturnValue(false);

      watcher.start(['/non-existent']);

      expect(mockWatch).not.toHaveBeenCalled();
    });

    it('starts watching existing directories with recursive option', () => {
      mockExistsSync.mockReturnValue(true);
      const fakeWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as unknown as FSWatcher);

      watcher.start(['/existing-dir']);

      expect(mockWatch).toHaveBeenCalledWith('/existing-dir', { recursive: true }, expect.any(Function));
    });

    it('logs warning when fs.watch throws (unsupported on Linux)', () => {
      mockExistsSync.mockReturnValue(true);
      mockWatch.mockImplementation(() => {
        throw new Error('ENOSYS: function not implemented');
      });

      watcher.start(['/existing-dir']);

      expect(mockLogger.warning).toHaveBeenCalled();
    });

    it('logs info message when watching starts successfully', () => {
      mockExistsSync.mockReturnValue(true);
      const fakeWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as unknown as FSWatcher);

      watcher.start(['/existing-dir']);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('/existing-dir'));
    });
  });

  // ─── handleChange() ────────────────────────────────────────────────────────

  describe('handleChange() — called via private method access', () => {
    it('indexes .md file via indexFile when docsMatcher includes it', async () => {
      mockExistsSync.mockReturnValue(true);

      await (watcher as any).handleChange('/some/dir/README.md');

      expect(mockIndexer.indexFile).toHaveBeenCalledWith('/some/dir/README.md');
      expect(mockIndexer.indexCodeFile).not.toHaveBeenCalled();
    });

    it('indexes .ts file via indexCodeFile when codeMatcher includes it', async () => {
      mockExistsSync.mockReturnValue(true);

      await (watcher as any).handleChange('/some/dir/app.ts');

      expect(mockIndexer.indexCodeFile).toHaveBeenCalledWith('/some/dir/app.ts');
      expect(mockIndexer.indexFile).not.toHaveBeenCalled();
    });

    it('calls db.deleteDocument when file no longer exists', async () => {
      mockExistsSync.mockReturnValue(false);

      await (watcher as any).handleChange('/some/dir/deleted.md');

      expect(mockDb.deleteDocument).toHaveBeenCalledWith('/some/dir/deleted.md');
    });

    it('returns early when syncManager.inProgress is true', async () => {
      mockSyncManager.inProgress = true;
      mockExistsSync.mockReturnValue(true);

      await (watcher as any).handleChange('/some/dir/README.md');

      expect(mockIndexer.indexFile).not.toHaveBeenCalled();
      expect(mockIndexer.indexCodeFile).not.toHaveBeenCalled();
    });

    it('skips .md file when docsMatcher excludes it', async () => {
      mockExistsSync.mockReturnValue(true);
      vi.mocked(mockDocsMatcher.isIncluded).mockReturnValue(false);

      await (watcher as any).handleChange('/some/dir/README.md');

      expect(mockIndexer.indexFile).not.toHaveBeenCalled();
    });

    it('skips .ts file when codeMatcher excludes it', async () => {
      mockExistsSync.mockReturnValue(true);
      vi.mocked(mockCodeMatcher.isIncluded).mockReturnValue(false);

      await (watcher as any).handleChange('/some/dir/app.ts');

      expect(mockIndexer.indexCodeFile).not.toHaveBeenCalled();
    });

    it('ignores files with unsupported extensions', async () => {
      mockExistsSync.mockReturnValue(true);

      await (watcher as any).handleChange('/some/dir/file.xyz');

      expect(mockIndexer.indexFile).not.toHaveBeenCalled();
      expect(mockIndexer.indexCodeFile).not.toHaveBeenCalled();
    });

    it('does not throw when deleteDocument throws (file was not indexed)', async () => {
      mockExistsSync.mockReturnValue(false);
      vi.mocked(mockDb.deleteDocument).mockImplementation(() => {
        throw new Error('Document not found');
      });

      await expect(
        (watcher as any).handleChange('/some/dir/README.md'),
      ).resolves.not.toThrow();
    });

    it('does not throw when indexFile throws', async () => {
      mockExistsSync.mockReturnValue(true);
      vi.mocked(mockIndexer.indexFile).mockRejectedValue(new Error('indexing failed'));

      await expect(
        (watcher as any).handleChange('/some/dir/README.md'),
      ).resolves.not.toThrow();

      expect(mockLogger.warning).toHaveBeenCalled();
    });
  });

  // ─── close() ───────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('closes all file watchers', () => {
      mockExistsSync.mockReturnValue(true);
      const fakeWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
      // Return the same fake watcher for all calls
      mockWatch.mockReturnValue(fakeWatcher as unknown as FSWatcher);

      watcher.start(['/dir1', '/dir2']);
      watcher.close();

      expect(fakeWatcher.close).toHaveBeenCalledTimes(2);
    });

    it('is safe to call when no watchers are active', () => {
      expect(() => watcher.close()).not.toThrow();
    });
  });
});
