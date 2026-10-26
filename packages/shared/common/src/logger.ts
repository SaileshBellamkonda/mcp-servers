import type { McpServer, LoggingLevel } from '@modelcontextprotocol/server';

export class McpLogger {
  private readonly server: McpServer;
  private readonly name: string;

  constructor(server: McpServer, name: string) {
    this.server = server;
    this.name = name;
  }

  log(level: LoggingLevel, data: unknown): void {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    process.stderr.write(`[${level.toUpperCase()}] [${this.name}] ${msg}\n`);
    void this.server.sendLoggingMessage({ level, logger: this.name, data }).catch((_e: unknown) => { /* fire-and-forget */ });
  }

  debug(data: unknown): void { this.log('debug', data); }
  info(data: unknown): void { this.log('info', data); }
  notice(data: unknown): void { this.log('notice', data); }
  warning(data: unknown): void { this.log('warning', data); }
  error(data: unknown): void { this.log('error', data); }
  critical(data: unknown): void { this.log('critical', data); }
}
