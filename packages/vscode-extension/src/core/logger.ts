import type { ServerLogger } from './server-descriptor';

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

/**
 * A ServerLogger writing `<ISO time> [level] message` lines through `write` (an OutputChannel's `appendLine` in the
 * extension). `now` is injected so tests do not depend on the clock.
 */
export function createLineLogger(write: (line: string) => void, now: () => Date = () => new Date()): ServerLogger {
  const log =
    (level: string) =>
    (data: unknown): void => {
      write(`${now().toISOString()} [${level}] ${formatLogData(data)}`);
    };
  return { info: log('info'), warning: log('warning'), error: log('error') };
}
