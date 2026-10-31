import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { IndexFreshness } from '../../../src/indexer/freshness.ts';
import type { CodeChunk, MarkdownChunk } from '../../../src/core/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-freshness-test');
const VEC = [0.1, 0.2, 0.3, 0.4];
const silent = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };

const file = (name: string): string => path.join(tmpDir, name);
const mdChunk: MarkdownChunk = { content: 'text', position: 0 };
const codeChunk: CodeChunk = {
  content: 'function f() {}', position: 0, symbolName: 'f', symbolType: 'function', language: 'typescript',
  startLine: 1, endLine: 1, parentSymbol: '', signature: 'function f()',
};

let db: VectorDB;
let sync: { inProgress: boolean };
let refresh: ReturnType<typeof vi.fn<(p: string) => Promise<boolean>>>;
let freshness: IndexFreshness;

/** Writes the file with a fixed modification time and indexes it with that time. */
function indexed(name: string, mtimeMs: number, kind: 'doc' | 'code' = 'code'): void {
  writeFileSync(file(name), 'x');
  utimesSync(file(name), new Date(mtimeMs), new Date(mtimeMs));
  if (kind === 'code') db.insertCodeDocument(file(name), new Date(mtimeMs), [codeChunk], [VEC]);
  else db.insertDocument(file(name), new Date(mtimeMs), [mdChunk], [VEC], { title: 'T', tags: [], extra: {} });
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', 4);
  sync = { inProgress: false };
  refresh = vi.fn<(p: string) => Promise<boolean>>().mockResolvedValue(true);
  freshness = new IndexFreshness(db, { refresh }, sync, silent, { debounceMs: 5, failureCooldownMs: 1000 });
});

afterEach(() => {
  freshness.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('IndexFreshness.classify', () => {
  it('reports files as fresh, changed (modification time differs) or missing (gone from disk)', () => {
    indexed('same.ts', 1_700_000_000_000);
    indexed('edited.ts', 1_700_000_000_000);
    utimesSync(file('edited.ts'), new Date(1_700_000_005_000), new Date(1_700_000_005_000));
    indexed('deleted.ts', 1_700_000_000_000);
    rmSync(file('deleted.ts'));
    indexed('guide.md', 1_700_000_000_000, 'doc');

    const states = freshness.classify([file('same.ts'), file('edited.ts'), file('deleted.ts'), file('guide.md')]);

    expect(states.get(file('same.ts'))).toBe('fresh');
    expect(states.get(file('edited.ts'))).toBe('changed');
    expect(states.get(file('deleted.ts'))).toBe('missing');
    expect(states.get(file('guide.md'))).toBe('fresh');
  });

  it('checks every distinct file once', () => {
    indexed('a.ts', 1_700_000_000_000);
    const stat = vi.fn(() => ({ mtime: new Date(1_700_000_000_000) }));
    const counting = new IndexFreshness(db, { refresh }, sync, silent, { stat });
    const states = counting.classify([file('a.ts'), file('a.ts'), file('a.ts')]);
    expect(states.size).toBe(1);
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it('treats a file the index does not know, or one it cannot stat for another reason, as fresh', () => {
    writeFileSync(file('unknown.ts'), 'x');
    const denied = new IndexFreshness(db, { refresh }, sync, silent, {
      stat: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    });
    indexed('known.ts', 1_700_000_000_000);
    expect(freshness.classify([file('unknown.ts')]).get(file('unknown.ts'))).toBe('fresh');
    expect(denied.classify([file('known.ts')]).get(file('known.ts'))).toBe('fresh');
  });
});

describe('IndexFreshness.scheduleRefresh', () => {
  it('refreshes each scheduled file once, after the debounce, without blocking the caller', async () => {
    freshness.scheduleRefresh([file('a.ts'), file('b.ts')]);
    freshness.scheduleRefresh([file('a.ts')]);
    expect(refresh).not.toHaveBeenCalled();
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalledTimes(2); });
    expect(refresh.mock.calls.map(([p]) => p).sort()).toEqual([file('a.ts'), file('b.ts')]);
  });

  it('does nothing while a manual sync runs (the sync handles those files)', async () => {
    sync.inProgress = true;
    freshness.scheduleRefresh([file('a.ts')]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not retry a file whose refresh failed until the cool-down has passed', async () => {
    let now = 0;
    const clocked = new IndexFreshness(db, { refresh }, sync, silent, { debounceMs: 5, failureCooldownMs: 1000, now: () => now });
    refresh.mockResolvedValueOnce(false);
    clocked.scheduleRefresh([file('a.ts')]);
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalledTimes(1); });
    await new Promise((resolve) => setTimeout(resolve, 20));

    now = 500;
    clocked.scheduleRefresh([file('a.ts')]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(refresh).toHaveBeenCalledTimes(1);

    now = 2000;
    clocked.scheduleRefresh([file('a.ts')]);
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalledTimes(2); });
    clocked.close();
  });

  it('survives a refresh that throws, and waits out the cool-down for that file too', async () => {
    let now = 0;
    const clocked = new IndexFreshness(db, { refresh }, sync, silent, { debounceMs: 5, failureCooldownMs: 1000, now: () => now });
    refresh.mockRejectedValueOnce(new Error('boom'));
    clocked.scheduleRefresh([file('a.ts')]);
    await vi.waitFor(() => { expect(silent.warning).toHaveBeenCalled(); });
    now = 10;
    clocked.scheduleRefresh([file('a.ts')]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(refresh).toHaveBeenCalledTimes(1);
    clocked.close();
  });

  it('close() cancels pending refreshes', async () => {
    freshness.scheduleRefresh([file('a.ts')]);
    freshness.close();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(refresh).not.toHaveBeenCalled();
  });
});
