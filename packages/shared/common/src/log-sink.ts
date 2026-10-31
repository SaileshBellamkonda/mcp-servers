import { mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { loadLogConfigFromEnv } from './env.ts';
import { isLevelEnabled, type LogLevel } from './log-level.ts';

/** Receives every log entry of a server: `name` is the logger (component) that produced it. */
export type LogSink = (level: LogLevel, name: string, data: unknown) => void;

/** Logger for services that are not tied to an MCP session (indexer, watcher, HTTP host). */
export interface SinkLogger {
  debug(data: unknown): void;
  info(data: unknown): void;
  notice(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
  critical(data: unknown): void;
}

/** What a host (the VS Code extension) offers as a logger; `debug` is optional. */
export interface HostLogger {
  debug?(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

/** Renders whatever a caller hands to a logger as one line of text (never throws). */
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

/** Drops every entry. Servers log nowhere unless a sink says where. */
export const noopSink: LogSink = () => undefined;

/**
 * Appends `<ISO time> [LEVEL] [name] message` lines to `file` for entries at or above `threshold`. Writes are
 * synchronous so the lines survive `process.exit` in the shutdown handlers; a failing write is dropped, because
 * logging must never take the server down. The file (0600) and its parent directories are created up front, so
 * an unusable path fails at startup.
 */
export function createFileSink(file: string, threshold: LogLevel, now: () => Date = () => new Date()): LogSink {
  mkdirSync(path.dirname(file), { recursive: true });
  const fd = openSync(file, 'a', 0o600);
  return (level, name, data) => {
    if (!isLevelEnabled(level, threshold)) return;
    try {
      writeSync(fd, `${now().toISOString()} [${level.toUpperCase()}] [${name}] ${formatLogData(data)}\n`);
    } catch {
      // disk full, file removed, ...: nothing sensible to do
    }
  };
}

/** A file sink at `LOG_LEVEL` when `LOG_FILE` is set, otherwise {@link noopSink}. Throws on an invalid `LOG_LEVEL`. */
export function createSinkFromEnv(env: Readonly<Record<string, string | undefined>>): LogSink {
  const { level, file } = loadLogConfigFromEnv(env);
  return file === undefined ? noopSink : createFileSink(file, level);
}

export function createSinkLogger(name: string, sink: LogSink): SinkLogger {
  return {
    debug: (data) => { sink('debug', name, data); },
    info: (data) => { sink('info', name, data); },
    notice: (data) => { sink('notice', name, data); },
    warning: (data) => { sink('warning', name, data); },
    error: (data) => { sink('error', name, data); },
    critical: (data) => { sink('critical', name, data); },
  };
}

/** Adapts a host logger to a sink: notice maps to info, critical and above to error, debug is dropped when unsupported. */
export function createHostSink(logger: HostLogger | undefined): LogSink {
  if (logger === undefined) return noopSink;
  return (level, _name, data) => {
    switch (level) {
      case 'debug':
        logger.debug?.(data);
        break;
      case 'info':
      case 'notice':
        logger.info(data);
        break;
      case 'warning':
        logger.warning(data);
        break;
      default:
        logger.error(data);
    }
  };
}
