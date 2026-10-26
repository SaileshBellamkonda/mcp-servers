/**
 * Logger shape used by the long-lived CodeRAG services (indexer, sync, watcher).
 * `McpLogger` satisfies it; `createStderrLogger` provides a session-independent implementation.
 */
export interface CodeRagLogger {
  debug(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

function write(level: string, name: string, data: unknown): void {
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  process.stderr.write(`[${level}] [${name}] ${message}\n`);
}

/** A logger that only writes `[LEVEL] [name] message` lines to stderr and is not tied to any MCP session. */
export function createStderrLogger(name = 'coderag'): CodeRagLogger {
  return {
    debug: (data) => { write('DEBUG', name, data); },
    info: (data) => { write('INFO', name, data); },
    warning: (data) => { write('WARNING', name, data); },
    error: (data) => { write('ERROR', name, data); },
  };
}
