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
import { isLoopbackHost } from './loopback.ts';
import { bodyLimit, jsonContentType, jsonRpcError, originGuard } from './guards.ts';
import { assertSafeBinding, bearerAuth } from './security.ts';

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
  /**
   * Extra browser origins to accept, as a full origin (`https://app.example`) or a host name.
   * Loopback origins are always accepted; any other `Origin` header is rejected with 403 in
   * every mode. Requests without an Origin header are unaffected.
   */
  allowedOrigins?: string[];
  /** Maximum concurrent sessions (default 64); further initializes get 429 + Retry-After. */
  maxSessions?: number;
  /** Close a session after this many ms without any request for it (default 30 minutes; 0 disables). */
  sessionIdleTimeoutMs?: number;
  /** Maximum request body size in bytes (default 4 MiB); larger bodies get 413 before parsing. */
  maxBodyBytes?: number;
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
const DEFAULT_MAX_SESSIONS = 64;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_FULL_RETRY_AFTER_SECONDS = '5';

/** Used when the caller supplies no logger: the host logs only where it is told to. */
const silentLogger: HttpHostLogger = {
  info: () => undefined,
  warning: () => undefined,
  error: () => undefined,
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

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
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
  const logger = options.logger ?? silentLogger;
  assertSafeBinding({ host, token });
  const maxSessions = positiveInteger('maxSessions', options.maxSessions ?? DEFAULT_MAX_SESSIONS);
  const maxBodyBytes = positiveInteger('maxBodyBytes', options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  const idleTimeoutMs = options.sessionIdleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new RangeError('sessionIdleTimeoutMs must be a finite number >= 0 (0 disables idle expiry)');
  }

  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();
  const idleTimers = new Map<string, NodeJS.Timeout>();
  /** Sessions being created right now; counted against the cap before a server is built. */
  let pending = 0;

  const clearIdle = (sid: string): void => {
    const timer = idleTimers.get(sid);
    if (timer !== undefined) clearTimeout(timer);
    idleTimers.delete(sid);
  };
  /** (Re)starts the idle countdown for a live session; any request for it calls this. */
  const touch = (sid: string): void => {
    if (idleTimeoutMs === 0) return;
    const transport = sessions.get(sid);
    if (!transport) return;
    clearIdle(sid);
    const timer = setTimeout(() => {
      logger.info(`closing idle MCP session ${sid}`);
      transport.close().catch((err: unknown) => { logger.error(`closing idle session failed: ${describe(err)}`); });
    }, idleTimeoutMs);
    timer.unref();
    idleTimers.set(sid, timer);
  };

  const app = new Hono();
  // Order matters: cheap header checks first, the body is only read after all of them pass.
  app.use('*', originGuard(options.allowedOrigins));
  app.use('*', bearerAuth(token));
  app.use('*', jsonContentType());
  app.use('*', bodyLimit(maxBodyBytes));
  const mcp = createMcpHonoApp(hostHeaderConfig(host, options.allowedHosts));

  const discard = async (transport: WebStandardStreamableHTTPServerTransport, server: McpServer): Promise<void> => {
    const sid = transport.sessionId;
    if (sid !== undefined) {
      clearIdle(sid);
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
        if (!existing) return unknownSession(c);
        touch(sessionId);
        return await existing.handleRequest(c.req.raw);
      }
      if (sessions.size + pending >= maxSessions) {
        return jsonRpcError(c, 429, -32000, 'Too many sessions; retry later', { 'Retry-After': SESSION_FULL_RETRY_AFTER_SECONDS });
      }
      pending += 1;
      try {
        return await createSession(c.req.raw);
      } finally {
        pending -= 1;
      }
    } catch (err) {
      logger.error(`MCP request error: ${describe(err)}`);
      return c.text('Internal server error', 500);
    }
  });

  const unknownSession = (c: Context): Response => jsonRpcError(c, 404, -32001, 'Session not found');

  const createSession = async (request: Request): Promise<Response> => {
    const server = await options.createServer();
    const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
        servers.set(sid, server);
        touch(sid);
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
    const response = await transport.handleRequest(request);
    if (transport.sessionId === undefined || !sessions.has(transport.sessionId)) {
      // Not an initialize request (or it failed): no session was created, release the server.
      await transport.close();
    }
    return response;
  };

  const forward = (c: Context): Promise<Response> | Response => {
    const sessionId = c.req.header('mcp-session-id');
    if (!sessionId) return c.text('Missing session ID', 400);
    const transport = sessions.get(sessionId);
    if (!transport) return unknownSession(c);
    touch(sessionId);
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
      for (const sid of [...idleTimers.keys()]) clearIdle(sid);
      sessions.clear();
      servers.clear();
      httpServer.closeAllConnections();
      await closed;
    })();
    return closing;
  };

  return { address, port: address.port, host, sessions, close };
}
