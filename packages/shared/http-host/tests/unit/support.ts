import { request as httpRequest } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';

export const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1.0.0' } },
});

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface RawOptions {
  port: number;
  method?: string;
  headers?: Record<string, string>;
  /** Sent in one write; set a Content-Length header yourself when it matters. */
  body?: string;
  /** Sent chunk by chunk with chunked transfer encoding (no Content-Length). */
  chunks?: Iterable<string>;
}

/** Issues a request with fully forged headers over a real socket (fetch refuses to set Origin/Host). */
export function rawRequest(options: RawOptions): Promise<RawResponse> {
  const { port, method = 'POST', headers = {}, body, chunks } = options;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { text += d; });
      const done = (): void => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }); };
      res.on('end', done);
      res.on('error', done);
      res.on('close', done);
    });
    // The server may answer 413 and drop the connection while we are still writing.
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
      reject(err);
    });
    if (chunks) {
      void (async () => {
        for (const chunk of chunks) {
          if (req.destroyed) return;
          if (!req.write(chunk)) await new Promise((r) => req.once('drain', r));
        }
        req.end();
      })();
    } else {
      req.end(body);
    }
  });
}

export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

/** Factory whose created servers can be counted and checked for being released. */
export function makeCountingFactory(): { servers: McpServer[]; createServer: () => McpServer } {
  const servers: McpServer[] = [];
  return {
    servers,
    createServer: () => {
      const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { logging: {} } });
      servers.push(server);
      return server;
    },
  };
}
