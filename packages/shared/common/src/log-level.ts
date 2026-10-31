import type { LoggingLevel } from '@modelcontextprotocol/server';

export type LogLevel = LoggingLevel;

/** The MCP logging levels, from least to most severe. */
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** True when an entry at `level` should be written given the configured `threshold`. */
export function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}
