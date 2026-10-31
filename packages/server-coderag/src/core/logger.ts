/**
 * Logger shape used by the long-lived CodeRAG services (indexer, sync, watcher).
 * `McpLogger` and `createSinkLogger` from `@mcp-servers/common` satisfy it.
 */
export interface CodeRagLogger {
  debug(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

/** Discards every entry: what a service logs to when its caller supplies no logger. */
export const silentLogger: CodeRagLogger = {
  debug: () => undefined,
  info: () => undefined,
  warning: () => undefined,
  error: () => undefined,
};
