import { describe, it, expect } from 'vitest';
import { SyncManager, SyncInProgressError, syncLockedResponse } from '../../../src/indexer/sync-manager.js';

describe('SyncManager — initial state', () => {
  it('starts with inProgress = false', () => {
    expect(new SyncManager().inProgress).toBe(false);
  });

  it('starts with no operation', () => {
    const sm = new SyncManager();
    expect(sm.status.operation).toBeNull();
    expect(sm.status.startedAt).toBeNull();
  });
});

describe('SyncManager.run', () => {
  it('sets inProgress = true while the operation runs', async () => {
    const sm = new SyncManager();
    let captured = false;
    await sm.run('test', async () => { captured = sm.inProgress; });
    expect(captured).toBe(true);
  });

  it('exposes operation name while running', async () => {
    const sm = new SyncManager();
    let op: string | null = null;
    await sm.run('my-op', async () => { op = sm.status.operation; });
    expect(op).toBe('my-op');
  });

  it('records startedAt while running', async () => {
    const sm = new SyncManager();
    let at: Date | null = null;
    await sm.run('t', async () => { at = sm.status.startedAt; });
    expect(at).toBeInstanceOf(Date);
  });

  it('clears all state after completion', async () => {
    const sm = new SyncManager();
    await sm.run('test', async () => {});
    expect(sm.inProgress).toBe(false);
    expect(sm.status.operation).toBeNull();
    expect(sm.status.startedAt).toBeNull();
  });

  it('clears state even if fn throws', async () => {
    const sm = new SyncManager();
    await expect(
      sm.run('boom', async () => { throw new Error('fail'); })
    ).rejects.toThrow('fail');
    expect(sm.inProgress).toBe(false);
    expect(sm.status.operation).toBeNull();
  });

  it('throws SyncInProgressError when already running', async () => {
    const sm = new SyncManager();
    let releaseLock!: () => void;
    const first = sm.run('first', () => new Promise<void>((r) => { releaseLock = r; }));
    await expect(sm.run('second', async () => {})).rejects.toBeInstanceOf(SyncInProgressError);
    releaseLock();
    await first;
  });

  it('SyncInProgressError carries the name of the running operation', async () => {
    const sm = new SyncManager();
    let releaseLock!: () => void;
    const first = sm.run('active-op', () => new Promise<void>((r) => { releaseLock = r; }));
    let caught: unknown;
    try { await sm.run('second', async () => {}); } catch (e) { caught = e; }
    expect((caught as SyncInProgressError).operation).toBe('active-op');
    releaseLock();
    await first;
  });

  it('allows a new run after the previous one completes', async () => {
    const sm = new SyncManager();
    await sm.run('first', async () => {});
    await expect(sm.run('second', async () => {})).resolves.not.toThrow();
  });
});

describe('SyncInProgressError', () => {
  it('is an instance of Error', () => {
    expect(new SyncInProgressError('x')).toBeInstanceOf(Error);
  });

  it('has name = SyncInProgressError', () => {
    expect(new SyncInProgressError('x').name).toBe('SyncInProgressError');
  });

  it('includes operation in message', () => {
    expect(new SyncInProgressError('sync-op').message).toContain('sync-op');
  });

  it('exposes operation property', () => {
    expect(new SyncInProgressError('my-op').operation).toBe('my-op');
  });
});

describe('syncLockedResponse', () => {
  const makeStatus = (op = 'sync') => ({
    inProgress: true,
    operation: op,
    startedAt: new Date('2024-01-01T00:00:00Z'),
  });

  it('returns locked: true', () => {
    const data = JSON.parse(syncLockedResponse(makeStatus()).content[0]!.text) as { locked: boolean };
    expect(data.locked).toBe(true);
  });

  it('includes the operation name', () => {
    const data = JSON.parse(syncLockedResponse(makeStatus('startup')).content[0]!.text) as { operation: string };
    expect(data.operation).toBe('startup');
  });

  it('includes startedAt as ISO string', () => {
    const date = new Date('2024-06-15T10:30:00Z');
    const data = JSON.parse(syncLockedResponse({ inProgress: true, operation: 'x', startedAt: date }).content[0]!.text) as { startedAt: string };
    expect(data.startedAt).toBe(date.toISOString());
  });

  it('includes a human-readable message mentioning the operation', () => {
    const data = JSON.parse(syncLockedResponse(makeStatus('my-op')).content[0]!.text) as { message: string };
    expect(data.message).toContain('my-op');
  });

  it('handles null startedAt gracefully', () => {
    const data = JSON.parse(syncLockedResponse({ inProgress: true, operation: null, startedAt: null }).content[0]!.text) as { startedAt: null };
    expect(data.startedAt).toBeNull();
  });

  it('content type is "text"', () => {
    expect(syncLockedResponse(makeStatus()).content[0]!.type).toBe('text');
  });
});
