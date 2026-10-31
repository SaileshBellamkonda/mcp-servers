import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/emitter';
import { InMemoryTokenProvider } from '../../src/core/token-provider';
import { createLineLogger, readLogLevel } from '../../src/core/logger';
import type { ConfigReader } from '../../src/core/server-descriptor';

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
    const logger = createLineLogger((line) => lines.push(line), () => 'debug', now);
    logger.debug('trace');
    logger.info('hello');
    logger.warning('careful');
    logger.error('broken');
    expect(lines).toEqual([
      '2026-01-02T03:04:05.678Z [debug] trace',
      '2026-01-02T03:04:05.678Z [info] hello',
      '2026-01-02T03:04:05.678Z [warning] careful',
      '2026-01-02T03:04:05.678Z [error] broken',
    ]);
  });

  it('serialises non-string data as JSON and survives values JSON cannot handle', () => {
    const lines: string[] = [];
    const logger = createLineLogger((line) => lines.push(line), () => 'info', now);
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    logger.info({ a: 1 });
    logger.info(circular);
    logger.info(undefined);
    expect(lines[0]).toBe('2026-01-02T03:04:05.678Z [info] {"a":1}');
    expect(lines[1]).toMatch(/\[info\] \[object Object\]/);
    expect(lines[2]).toMatch(/\[info\] undefined$/);
  });

  it.each([
    ['debug', ['debug', 'info', 'warning', 'error']],
    ['info', ['info', 'warning', 'error']],
    ['warning', ['warning', 'error']],
    ['error', ['error']],
  ] as const)('at level %s writes only %j', (level, expected) => {
    const lines: string[] = [];
    const logger = createLineLogger((line) => lines.push(line), () => level, now);
    logger.debug('m');
    logger.info('m');
    logger.warning('m');
    logger.error('m');
    expect(lines.map((line) => /\[(\w+)\]/.exec(line)?.[1])).toEqual([...expected]);
  });

  it('reads the level on every call, so a changed setting applies immediately', () => {
    const lines: string[] = [];
    let level: 'info' | 'debug' = 'info';
    const logger = createLineLogger((line) => lines.push(line), () => level, now);
    logger.debug('hidden');
    level = 'debug';
    logger.debug('shown');
    expect(lines).toEqual(['2026-01-02T03:04:05.678Z [debug] shown']);
  });
});

describe('readLogLevel', () => {
  const config = (value: unknown): ConfigReader => ({
    get: <T>(_section: string, _key: string, fallback: T): T => (value === undefined ? fallback : (value as T)),
  });

  it.each(['debug', 'info', 'warning', 'error'] as const)('accepts %s', (level) => {
    expect(readLogLevel(config(level), 'mcpServers.git')).toBe(level);
  });

  it('asks for the logLevel key of the server section', () => {
    const calls: unknown[][] = [];
    readLogLevel({ get: <T>(section: string, key: string, fallback: T): T => { calls.push([section, key, fallback]); return fallback; } }, 'mcpServers.coderag');
    expect(calls).toEqual([['mcpServers.coderag', 'logLevel', 'info']]);
  });

  it.each([undefined, '', 'verbose', 3, null])('falls back to info for %j', (value) => {
    expect(readLogLevel(config(value), 'mcpServers.git')).toBe('info');
  });
});
