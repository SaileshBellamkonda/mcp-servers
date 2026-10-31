import { describe, expect, it } from 'vitest';
import { loadLogConfigFromEnv, parseBool, parseList, parseLogLevel, parsePort } from '../../src/env.ts';

describe('parsePort', () => {
  it('returns the default when the value is undefined, empty or blank', () => {
    expect(parsePort(undefined, 3000)).toBe(3000);
    expect(parsePort('', 3000)).toBe(3000);
    expect(parsePort('   ', 3100)).toBe(3100);
  });

  it('parses valid ports including the 0 and 65535 bounds and trims whitespace', () => {
    expect(parsePort('8080', 3000)).toBe(8080);
    expect(parsePort(' 8080 ', 3000)).toBe(8080);
    expect(parsePort('0', 3000)).toBe(0);
    expect(parsePort('65535', 3000)).toBe(65535);
  });

  it.each(['abc', '12abc', '3000.5', '-1', '65536', '1e3', '0x10', '99999999999999999999'])(
    'throws on garbage or out-of-range value %j instead of returning NaN',
    (value) => {
      expect(() => parsePort(value, 3000)).toThrow(/port/i);
    },
  );

  it('includes the offending value in the error message', () => {
    expect(() => parsePort('nope', 3000)).toThrow(/nope/);
  });
});

describe('parseList', () => {
  it('returns the default when the value is undefined, blank or contains only separators', () => {
    expect(parseList(undefined, ['a'])).toEqual(['a']);
    expect(parseList('   ', ['a'])).toEqual(['a']);
    expect(parseList(';; ;', ['a'])).toEqual(['a']);
  });

  it('defaults to an empty list', () => {
    expect(parseList(undefined)).toEqual([]);
  });

  it('splits on semicolons', () => {
    expect(parseList('/repo/one;/repo/two')).toEqual(['/repo/one', '/repo/two']);
  });

  it('trims entries (regression: server-git standalone kept surrounding whitespace)', () => {
    expect(parseList(' /repo/one ; /repo/two\t')).toEqual(['/repo/one', '/repo/two']);
  });

  it('drops empty entries', () => {
    expect(parseList('a;;b;  ;c;')).toEqual(['a', 'b', 'c']);
  });

  it('does not return the caller-supplied default array itself', () => {
    const fallback = ['x'];
    const result = parseList(undefined, fallback);
    expect(result).toEqual(['x']);
    expect(result).not.toBe(fallback);
  });
});

describe('parseBool', () => {
  it('returns the default when the value is undefined or blank', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool('  ', false)).toBe(false);
  });

  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on'])('treats %j as true', (value) => {
    expect(parseBool(value, false)).toBe(true);
  });

  it.each(['false', 'FALSE', ' False ', '0', 'no', 'off'])('treats %j as false', (value) => {
    expect(parseBool(value, true)).toBe(false);
  });

  it('falls back to the default for unrecognised values', () => {
    expect(parseBool('maybe', true)).toBe(true);
    expect(parseBool('maybe', false)).toBe(false);
  });
});

describe('parseLogLevel', () => {
  it('returns the default (info unless told otherwise) when unset or blank', () => {
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel('')).toBe('info');
    expect(parseLogLevel('   ')).toBe('info');
    expect(parseLogLevel(undefined, 'warning')).toBe('warning');
  });

  it('accepts every MCP level, ignoring case and surrounding whitespace', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel(' WARNING ')).toBe('warning');
    expect(parseLogLevel('Emergency')).toBe('emergency');
  });

  it('throws on an unknown level and names the value', () => {
    expect(() => parseLogLevel('verbose')).toThrow(/verbose/);
    expect(() => parseLogLevel('verbose')).toThrow(/LOG_LEVEL/);
  });
});

describe('loadLogConfigFromEnv', () => {
  it('defaults to info with no file', () => {
    expect(loadLogConfigFromEnv({})).toEqual({ level: 'info' });
  });

  it('reads LOG_LEVEL and LOG_FILE', () => {
    expect(loadLogConfigFromEnv({ LOG_LEVEL: 'debug', LOG_FILE: ' /var/log/mcp.log ' })).toEqual({
      level: 'debug',
      file: '/var/log/mcp.log',
    });
  });

  it('treats a blank LOG_FILE as unset', () => {
    expect(loadLogConfigFromEnv({ LOG_FILE: '  ' })).toEqual({ level: 'info' });
  });

  it('throws on an invalid LOG_LEVEL', () => {
    expect(() => loadLogConfigFromEnv({ LOG_LEVEL: 'loud' })).toThrow(/loud/);
  });
});
