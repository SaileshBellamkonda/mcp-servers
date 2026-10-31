import type { McpServer, LoggingLevel } from '@modelcontextprotocol/server';
import { noopSink, type LogSink } from './log-sink.ts';

/**
 * Logs to `sink` (the log file, the VS Code Output channel, or nowhere) and to the connected MCP client. Which
 * client notifications are delivered is up to the client's own `logging/setLevel`.
 */
export class McpLogger {
  private readonly server: McpServer;
  private readonly name: string;
  private readonly sink: LogSink;

  constructor(server: McpServer, name: string, sink: LogSink = noopSink) {
    this.server = server;
    this.name = name;
    this.sink = sink;
  }

  log(level: LoggingLevel, data: unknown): void {
    this.sink(level, this.name, data);
    void this.server.sendLoggingMessage({ level, logger: this.name, data }).catch((_e: unknown) => { /* fire-and-forget */ });
  }

  debug(data: unknown): void { this.log('debug', data); }
  info(data: unknown): void { this.log('info', data); }
  notice(data: unknown): void { this.log('notice', data); }
  warning(data: unknown): void { this.log('warning', data); }
  error(data: unknown): void { this.log('error', data); }
  critical(data: unknown): void { this.log('critical', data); }
}
