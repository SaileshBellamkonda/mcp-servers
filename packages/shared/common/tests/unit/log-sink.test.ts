import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFileSink,
  createHostSink,
  createSinkFromEnv,
  createSinkLogger,
  formatLogData,
  noopSink,
} from '../../src/log-sink.ts';

const FIXED = new Date('2026-10-31T12:34:56.000Z');

describe('formatLogData', () => {
  it('passes strings through', () => {
    expect(formatLogData('hello')).toBe('hello');
  });

  it('uses the message of an Error', () => {
    expect(formatLogData(new Error('boom'))).toBe('boom');
  });

  it('serialises objects as JSON', () => {
    expect(formatLogData({ a: 1 })).toBe('{"a":1}');
  });

  it('never throws on circular data', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => formatLogData(circular)).not.toThrow();
    expect(typeof formatLogData(circular)).toBe('string');
  });
});

describe('noopSink', () => {
  it('writes nothing to stderr or stdout', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    noopSink('error', 'unit', 'ignored');
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe('createFileSink', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'log-sink-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends timestamped [LEVEL] [name] lines', () => {
    const file = path.join(dir, 'app.log');
    const sink = createFileSink(file, 'info', () => FIXED);
    sink('info', 'unit', 'first');
    sink('error', 'unit', { a: 1 });

    expect(readFileSync(file, 'utf8')).toBe(
      '2026-10-31T12:34:56.000Z [INFO] [unit] first\n2026-10-31T12:34:56.000Z [ERROR] [unit] {"a":1}\n',
    );
  });

  it('drops entries below the threshold', () => {
    const file = path.join(dir, 'app.log');
    const sink = createFileSink(file, 'warning', () => FIXED);
    sink('debug', 'unit', 'no');
    sink('info', 'unit', 'no');
    sink('warning', 'unit', 'yes');

    expect(readFileSync(file, 'utf8')).toBe('2026-10-31T12:34:56.000Z [WARNING] [unit] yes\n');
  });

  it('creates missing parent directories', () => {
    const file = path.join(dir, 'nested', 'deeper', 'app.log');
    createFileSink(file, 'info')('info', 'unit', 'hi');

    expect(readFileSync(file, 'utf8')).toMatch(/\[INFO\] \[unit\] hi\n$/);
  });

  it('appends to an existing file instead of truncating it', () => {
    const file = path.join(dir, 'app.log');
    createFileSink(file, 'info', () => FIXED)('info', 'unit', 'one');
    createFileSink(file, 'info', () => FIXED)('info', 'unit', 'two');

    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
  });

  it.skipIf(process.platform === 'win32')('creates the file readable only by its owner', () => {
    const file = path.join(dir, 'app.log');
    createFileSink(file, 'info')('info', 'unit', 'secret');

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('does not throw when the file becomes unwritable', () => {
    const file = path.join(dir, 'app.log');
    const sink = createFileSink(file, 'info');
    rmSync(dir, { recursive: true, force: true });
    expect(() => { sink('info', 'unit', 'lost'); }).not.toThrow();
  });
});

describe('createSinkFromEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'log-sink-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes to LOG_FILE at LOG_LEVEL', () => {
    const file = path.join(dir, 'env.log');
    const sink = createSinkFromEnv({ LOG_FILE: file, LOG_LEVEL: 'error' });
    sink('warning', 'unit', 'no');
    sink('error', 'unit', 'yes');

    const text = readFileSync(file, 'utf8');
    expect(text).toContain('[ERROR] [unit] yes');
    expect(text).not.toContain('no');
  });

  it('defaults to info', () => {
    const file = path.join(dir, 'env.log');
    const sink = createSinkFromEnv({ LOG_FILE: file });
    sink('debug', 'unit', 'hidden');
    sink('info', 'unit', 'shown');

    const text = readFileSync(file, 'utf8');
    expect(text).toContain('shown');
    expect(text).not.toContain('hidden');
  });

  it('returns the no-op sink when LOG_FILE is unset, and never touches stderr', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sink = createSinkFromEnv({ LOG_LEVEL: 'debug' });

    expect(sink).toBe(noopSink);
    sink('error', 'unit', 'x');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('throws on an invalid LOG_LEVEL', () => {
    expect(() => createSinkFromEnv({ LOG_LEVEL: 'loud' })).toThrow(/loud/);
  });
});

describe('createSinkLogger', () => {
  it('routes every level to the sink under its name', () => {
    const sink = vi.fn();
    const logger = createSinkLogger('svc', sink);
    logger.debug('d');
    logger.info('i');
    logger.notice('n');
    logger.warning('w');
    logger.error('e');
    logger.critical('c');

    expect(sink.mock.calls).toEqual([
      ['debug', 'svc', 'd'],
      ['info', 'svc', 'i'],
      ['notice', 'svc', 'n'],
      ['warning', 'svc', 'w'],
      ['error', 'svc', 'e'],
      ['critical', 'svc', 'c'],
    ]);
  });
});

describe('createHostSink', () => {
  function host(withDebug: boolean) {
    const calls: [string, unknown][] = [];
    const logger = {
      info: (d: unknown) => calls.push(['info', d]),
      warning: (d: unknown) => calls.push(['warning', d]),
      error: (d: unknown) => calls.push(['error', d]),
      ...(withDebug && { debug: (d: unknown) => calls.push(['debug', d]) }),
    };
    return { logger, calls };
  }

  it('maps MCP levels onto the host logger', () => {
    const { logger, calls } = host(true);
    const sink = createHostSink(logger);
    sink('debug', 'n', 'a');
    sink('info', 'n', 'b');
    sink('notice', 'n', 'c');
    sink('warning', 'n', 'd');
    sink('error', 'n', 'e');
    sink('critical', 'n', 'f');
    sink('alert', 'n', 'g');
    sink('emergency', 'n', 'h');

    expect(calls).toEqual([
      ['debug', 'a'],
      ['info', 'b'],
      ['info', 'c'],
      ['warning', 'd'],
      ['error', 'e'],
      ['error', 'f'],
      ['error', 'g'],
      ['error', 'h'],
    ]);
  });

  it('drops debug entries when the host logger has no debug method', () => {
    const { logger, calls } = host(false);
    createHostSink(logger)('debug', 'n', 'quiet');
    expect(calls).toEqual([]);
  });

  it('is a no-op sink when no host logger is given', () => {
    expect(createHostSink(undefined)).toBe(noopSink);
  });
});
