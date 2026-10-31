import { describe, expect, it } from 'vitest';
import { LOG_LEVELS, isLevelEnabled } from '../../src/log-level.ts';

describe('LOG_LEVELS', () => {
  it('lists the MCP logging levels from least to most severe', () => {
    expect(LOG_LEVELS).toEqual(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']);
  });
});

describe('isLevelEnabled', () => {
  it('enables levels at or above the threshold', () => {
    expect(isLevelEnabled('info', 'info')).toBe(true);
    expect(isLevelEnabled('warning', 'info')).toBe(true);
    expect(isLevelEnabled('emergency', 'error')).toBe(true);
    expect(isLevelEnabled('debug', 'debug')).toBe(true);
  });

  it('disables levels below the threshold', () => {
    expect(isLevelEnabled('debug', 'info')).toBe(false);
    expect(isLevelEnabled('notice', 'warning')).toBe(false);
    expect(isLevelEnabled('warning', 'critical')).toBe(false);
  });
});
