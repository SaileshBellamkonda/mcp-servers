import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/emitter';
import { InMemoryTokenProvider } from '../../src/core/token-provider';
import { createLineLogger } from '../../src/core/logger';

describe('Emitter', () => {
  it('delivers events to every listener until disposed', () => {
    const emitter = new Emitter<number>();
    const a = vi.fn();
    const b = vi.fn();
    const subscription = emitter.event(a);
    emitter.event(b);
    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);
    expect(a.mock.calls).toEqual([[1]]);
    expect(b.mock.calls).toEqual([[1], [2]]);
  });

  it('a throwing listener neither stops the others nor breaks fire(); the error is reported', () => {
    const onError = vi.fn();
    const emitter = new Emitter<void>(onError);
    const boom = new Error('boom');
    const after = vi.fn();
    emitter.event(() => {
      throw boom;
    });
    emitter.event(after);
    expect(() => {
      emitter.fire();
    }).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('dispose() removes all listeners', () => {
    const emitter = new Emitter<void>();
    const listener = vi.fn();
    emitter.event(listener);
    emitter.dispose();
    emitter.fire();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('InMemoryTokenProvider', () => {
  it('returns a random 32-byte hex token', async () => {
    const tokens = new InMemoryTokenProvider();
    await expect(tokens.getToken('git', 'ws')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same token for the same server and scope within a session', async () => {
    const tokens = new InMemoryTokenProvider();
    expect(await tokens.getToken('git', 'ws')).toBe(await tokens.getToken('git', 'ws'));
  });

  it('returns different tokens for different servers, scopes and sessions', async () => {
    const tokens = new InMemoryTokenProvider();
    const git = await tokens.getToken('git', 'ws');
    expect(await tokens.getToken('coderag', 'ws')).not.toBe(git);
    expect(await tokens.getToken('git', 'other')).not.toBe(git);
    expect(await new InMemoryTokenProvider().getToken('git', 'ws')).not.toBe(git);
  });

  it('does not confuse ids and scopes that only differ in where a separator falls', async () => {
    const tokens = new InMemoryTokenProvider();
    expect(await tokens.getToken('a', 'b:c')).not.toBe(await tokens.getToken('a:b', 'c'));
  });
});

describe('createLineLogger', () => {
  const now = (): Date => new Date('2026-01-02T03:04:05.678Z');

  it('writes one timestamped line per message with the level', () => {
    const lines: string[] = [];
    const logger = createLineLogger((line) => lines.push(line), now);
    logger.info('hello');
    logger.warning('careful');
    logger.error('broken');
    expect(lines).toEqual([
      '2026-01-02T03:04:05.678Z [info] hello',
      '2026-01-02T03:04:05.678Z [warning] careful',
      '2026-01-02T03:04:05.678Z [error] broken',
    ]);
  });

  it('serialises non-string data as JSON and survives values JSON cannot handle', () => {
    const lines: string[] = [];
    const logger = createLineLogger((line) => lines.push(line), now);
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    logger.info({ a: 1 });
    logger.info(circular);
    logger.info(undefined);
    expect(lines[0]).toBe('2026-01-02T03:04:05.678Z [info] {"a":1}');
    expect(lines[1]).toMatch(/\[info\] \[object Object\]/);
    expect(lines[2]).toMatch(/\[info\] undefined$/);
  });
});
