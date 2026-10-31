import type { ConfigReader, ServerLogger } from './server-descriptor';

/** Renders whatever a server hands to its logger as one line of text (never throws). */
export function formatLogData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof Error) return data.message;
  try {
    const json = JSON.stringify(data);
    if (typeof json === 'string' && json !== '{}') return json;
  } catch {
    // circular or otherwise unserialisable: fall through to String()
  }
  return String(data);
}

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

/** Reads `<section>.logLevel`; anything but debug, info, warning or error counts as info. */
export function readLogLevel(config: ConfigReader, section: string): LogLevel {
  const value = config.get<unknown>(section, 'logLevel', 'info');
  return typeof value === 'string' && Object.hasOwn(LEVEL_RANK, value) ? (value as LogLevel) : 'info';
}

/**
 * A ServerLogger writing `<ISO time> [level] message` lines through `write` (an OutputChannel's `appendLine` in the
 * extension). Lines below the level `level()` returns are dropped; the level is read on every call, so a changed
 * setting applies at once. `now` is injected so tests do not depend on the clock.
 */
export function createLineLogger(write: (line: string) => void, level: () => LogLevel, now: () => Date = () => new Date()): ServerLogger {
  const log =
    (lineLevel: LogLevel) =>
    (data: unknown): void => {
      if (LEVEL_RANK[lineLevel] < LEVEL_RANK[level()]) return;
      write(`${now().toISOString()} [${lineLevel}] ${formatLogData(data)}`);
    };
  return { debug: log('debug'), info: log('info'), warning: log('warning'), error: log('error') };
}
