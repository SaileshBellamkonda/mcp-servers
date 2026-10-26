import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  WebStandardStreamableHTTPServerTransport,
  localhostAllowedHostnames,
  type McpServer,
} from '@modelcontextprotocol/server';
import { Hono, type Context } from 'hono';
import { isLoopbackHost } from './loopback.js';
import { assertSafeBinding, bearerAuth } from './security.js';

/** Logger shape the host needs; `McpLogger` from `@mcp-servers/common` satisfies it. */
export interface HttpHostLogger {
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

export interface SessionInfo {
  sessionId: string;
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

export interface StartMcpHttpServerOptions {
  /** Called once per session; build a fresh McpServer and share domain services via closure. */
  createServer: () => McpServer | Promise<McpServer>;
  /** TCP port; 0 picks a free port. */
  port: number;
  /** Interface to bind (default 127.0.0.1). A non-loopback host requires `token`. */
  host?: string;
  /** Bearer token (>= 32 chars). Omit to run unauthenticated (loopback only). */
  token?: string | undefined;
  logger?: HttpHostLogger;
  /** Allowed Host header names; defaults to the localhost names on a loopback bind. */
  allowedHosts?: string[];
  /** Called after a session is initialised; errors are logged and ignored. */
  onSessionCreated?: (session: SessionInfo) => void;
}

export interface McpHttpServer {
  address: AddressInfo;
  port: number;
  host: string;
  sessions: ReadonlyMap<string, WebStandardStreamableHTTPServerTransport>;
  close(): Promise<void>;
}

const DEFAULT_HOST = '127.0.0.1';

const stderrLogger: HttpHostLogger = {
  info: (data) => process.stderr.write(`[INFO] [http-host] ${String(data)}\n`),
  warning: (data) => process.stderr.write(`[WARNING] [http-host] ${String(data)}\n`),
  error: (data) => process.stderr.write(`[ERROR] [http-host] ${String(data)}\n`),
};

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function hostHeaderConfig(host: string, allowedHosts: string[] | undefined): { host: string; allowedHosts?: string[] } {
  if (allowedHosts) return { host, allowedHosts };
  if (!isLoopbackHost(host)) return { host };
  // createMcpHonoApp only validates for 127.0.0.1 / localhost / ::1, so spell the list out
  // for every loopback spelling (e.g. 127.0.0.2).
  const names = localhostAllowedHostnames();
  const bare = host.trim().toLowerCase();
  const own = bare.startsWith('[') ? bare : formatUrlHost(bare);
  return { host, allowedHosts: names.includes(own) ? names : [...names, own] };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function listen(httpServerFactory: () => Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    const httpServer = httpServerFactory();
    const onError = (err: Error): void => { reject(err); };
    httpServer.once('error', onError);
    httpServer.once('listening', () => {
      httpServer.off('error', onError);
      resolve(httpServer);
    });
  });
}

/**
 * Starts a secured Streamable HTTP host (POST/GET/DELETE `/mcp`) with one McpServer per session.
 * Resolves once listening; listen errors (e.g. EADDRINUSE) reject with the original error.
 */
export async function startMcpHttpServer(options: StartMcpHttpServerOptions): Promise<McpHttpServer> {
  const host = options.host ?? DEFAULT_HOST;
  const token = options.token === '' ? undefined : options.token;
  const logger = options.logger ?? stderrLogger;
  assertSafeBinding({ host, token });

  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();

  const app = new Hono();
  app.use('*', bearerAuth(token));
  const mcp = createMcpHonoApp(hostHeaderConfig(host, options.allowedHosts));

  const discard = async (transport: WebStandardStreamableHTTPServerTransport, server: McpServer): Promise<void> => {
    const sid = transport.sessionId;
    if (sid !== undefined) {
      sessions.delete(sid);
      servers.delete(sid);
    }
    await server.close().catch((err: unknown) => { logger.error(`closing MCP server failed: ${describe(err)}`); });
  };

  mcp.post('/mcp', async (c) => {
    const sessionId = c.req.header('mcp-session-id');
    try {
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) return c.text('Invalid session ID', 400);
        return await existing.handleRequest(c.req.raw);
      }
      const server = await options.createServer();
      const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, transport);
          servers.set(sid, server);
          try {
            options.onSessionCreated?.({ sessionId: sid, server, transport });
          } catch (err) {
            logger.error(`onSessionCreated hook failed: ${describe(err)}`);
          }
        },
      });
      let discarding = false;
      transport.onclose = () => {
        if (discarding) return;
        discarding = true;
        void discard(transport, server);
      };
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);
      if (transport.sessionId === undefined || !sessions.has(transport.sessionId)) {
        // Not an initialize request (or it failed): no session was created, release the server.
        await transport.close();
      }
      return response;
    } catch (err) {
      logger.error(`MCP request error: ${describe(err)}`);
      return c.text('Internal server error', 500);
    }
  });

  const forward = (c: Context): Promise<Response> | Response => {
    const sessionId = c.req.header('mcp-session-id');
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) return c.text('Invalid or missing session ID', 400);
    return transport.handleRequest(c.req.raw);
  };
  mcp.get('/mcp', (c) => forward(c));
  mcp.delete('/mcp', (c) => forward(c));
  app.route('/', mcp);

  const httpServer = await listen(() => serve({ fetch: app.fetch, port: options.port, hostname: host }) as unknown as Server);
  httpServer.on('error', (err) => { logger.error(`HTTP server error: ${describe(err)}`); });

  const address = httpServer.address() as AddressInfo;
  logger.info(`MCP HTTP server listening on http://${formatUrlHost(host)}:${String(address.port)}/mcp - auth: ${token === undefined ? 'disabled' : 'enabled'}`);
  if (token === undefined) {
    logger.warning('Authentication is disabled: any local process can call this server\'s tools. Set MCP_AUTH_TOKEN to require a bearer token.');
  }

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const closed = new Promise<void>((resolve) => {
        httpServer.close((err) => {
          if (err) logger.error(`closing HTTP server failed: ${describe(err)}`);
          resolve();
        });
      });
      // Stop accepting, then drop keep-alive connections; open SSE streams are ended below.
      httpServer.closeIdleConnections();
      await Promise.all(
        [...sessions.entries()].map(async ([sid, transport]) => {
          const server = servers.get(sid);
          try {
            await transport.close();
          } catch (err) {
            logger.error(`closing transport ${sid} failed: ${describe(err)}`);
          }
          await server?.close().catch(() => undefined);
        }),
      );
      sessions.clear();
      servers.clear();
      httpServer.closeAllConnections();
      await closed;
    })();
    return closing;
  };

  return { address, port: address.port, host, sessions, close };
}
