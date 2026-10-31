/**
 * Test helpers for the secured MCP HTTP host. Import via `@mcp-servers/http-host/testing`;
 * the main entry point never imports this module.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { startMcpHttpServer, type McpHttpServer, type StartMcpHttpServerOptions } from '../server.ts';

export interface TestServer extends McpHttpServer {
  /** Full `/mcp` URL on the bound address. */
  url: string;
}

export type StartTestServerOptions = Partial<StartMcpHttpServerOptions>;

const silentLogger = { info: () => undefined, warning: () => undefined, error: () => undefined };

/** Starts a host on an ephemeral port with a silent logger and a trivial default server. */
export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const server = await startMcpHttpServer({
    createServer: () => new McpServer({ name: 'test-server', version: '1.0.0' }, { capabilities: { logging: {} } }),
    port: 0,
    logger: silentLogger,
    ...options,
  });
  const urlHost = server.host.includes(':') ? `[${server.host}]` : server.host;
  return Object.assign(server, { url: `http://${urlHost}:${String(server.port)}/mcp` });
}

export interface RpcResponse {
  status: number;
  headers: Headers;
  sessionId: string | undefined;
  /** Raw response body. */
  text: string;
  /** Every JSON-RPC message in the body (one for JSON responses, one per SSE event otherwise). */
  messages: unknown[];
  /** The first message, if any. */
  message: unknown;
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

export interface SseEvent {
  event: string | undefined;
  id: string | undefined;
  data: string;
}

/** Incrementally parses an SSE byte stream into events (events with empty data, such as priming events, are dropped). */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = parseBlock(block);
      if (event) events.push(event);
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  const joined = data.join('\n');
  return joined === '' ? undefined : { event, id, data: joined };
}

function parseMessages(contentType: string, text: string): unknown[] {
  if (text.length === 0) return [];
  if (contentType.includes('text/event-stream')) {
    return new SseParser().push(`${text}\n\n`).flatMap((e) => {
      try { return [JSON.parse(e.data) as unknown]; } catch { return []; }
    });
  }
  if (contentType.includes('json')) {
    try { return [JSON.parse(text) as unknown]; } catch { return []; }
  }
  return [];
}

/** POSTs a JSON-RPC body to `/mcp`, accepting both JSON and SSE replies. */
export async function postJsonRpc(url: string, body: unknown, options: RequestOptions = {}): Promise<RpcResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const messages = parseMessages(res.headers.get('content-type') ?? '', text);
  return {
    status: res.status,
    headers: res.headers,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    text,
    messages,
    message: messages[0],
  };
}

export interface InitializeOptions {
  token?: string | undefined;
  headers?: Record<string, string>;
}

export interface InitializedSession extends RpcResponse {
  /** The `result` of the initialize response, if the request succeeded. */
  result: unknown;
}

function authHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

/** Performs an MCP `initialize` (and the `initialized` notification) over HTTP. */
export async function initializeSession(url: string, options: InitializeOptions = {}): Promise<InitializedSession> {
  const headers = { ...authHeaders(options.token), ...options.headers };
  const reply = await postJsonRpc(
    url,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-host-test', version: '1.0.0' } },
    },
    { headers },
  );
  const result = (reply.message as { result?: unknown } | undefined)?.result;
  if (reply.status === 200 && reply.sessionId) {
    await postJsonRpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, {
      headers: { ...headers, 'mcp-session-id': reply.sessionId },
    });
  }
  return { ...reply, result };
}

export interface EventStream {
  status: number;
  /** Next event, or `null` when the stream ended. Rejects after `timeoutMs` (default 2000). */
  next(timeoutMs?: number): Promise<SseEvent | null>;
  /** Waits `durationMs` and returns every event received meanwhile (consumed from the queue). */
  collect(durationMs: number): Promise<SseEvent[]>;
  /** Resolves when the stream has ended, whether by the server or by `close()`. */
  ended: Promise<void>;
  close(): void;
}

/** Opens the standalone GET `/mcp` SSE stream for a session. */
export async function openEventStream(
  url: string,
  sessionId: string,
  options: { token?: string | undefined } = {},
): Promise<EventStream> {
  const controller = new AbortController();
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId, ...authHeaders(options.token) },
    signal: controller.signal,
  });

  const queue: SseEvent[] = [];
  const waiters: (() => void)[] = [];
  let finished = false;
  const wake = (): void => { waiters.splice(0).forEach((w) => { w(); }); };

  const ended = (async () => {
    try {
      if (res.body === null) return;
      const parser = new SseParser();
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        queue.push(...parser.push(decoder.decode(chunk, { stream: true })));
        wake();
      }
    } catch {
      // aborted or reset: treated as the end of the stream
    } finally {
      finished = true;
      wake();
    }
  })();

  const waitForChange = (timeoutMs: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      waiters.push(() => { clearTimeout(timer); resolve(); });
    });

  return {
    status: res.status,
    ended,
    close: () => { controller.abort(); },
    async next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const event = queue.shift();
        if (event) return event;
        if (finished) return null;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`no SSE event within ${String(timeoutMs)}ms`);
        await waitForChange(remaining);
      }
    },
    async collect(durationMs) {
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return queue.splice(0);
    },
  };
}
