import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeSession, postJsonRpc } from '@mcp-servers/http-host/testing';
import { TOKEN, freePort, spawnStandalone, type StandaloneProcess } from '../../fixtures/standalone-process.ts';

describe('standalone coderag file watcher', () => {
  let dir: string;
  let proc: StandaloneProcess | undefined;
  let embeddingServer: Server | undefined;
  let embeddingUrl = '';

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-standalone-watch-'));
    mkdirSync(path.join(dir, 'src'));
    mkdirSync(path.join(dir, 'docs'));
    embeddingServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const input = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { input: string | string[] }).input;
        const texts = Array.isArray(input) ? input : [input];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: texts.map((_t, index) => ({ index, embedding: [0.1, 0.2, 0.3, 0.4] })) }));
      });
    });
    await new Promise<void>((resolve) => { embeddingServer?.listen(0, '127.0.0.1', resolve); });
    embeddingUrl = `http://127.0.0.1:${String((embeddingServer.address() as { port: number }).port)}/v1`;
  });

  afterEach(async () => {
    proc?.kill();
    await proc?.exited;
    proc = undefined;
    await new Promise<void>((resolve) => { embeddingServer?.close(() => { resolve(); }); });
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(extra: Record<string, string>): Promise<{ url: string; session: string }> {
    const port = await freePort();
    proc = spawnStandalone({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      CODERAG_EMBEDDING_URL: embeddingUrl,
      CODERAG_EMBEDDING_MODEL: 'watch-model',
      CODERAG_EMBEDDING_DIM: '4',
      CODERAG_DB_PATH: path.join(dir, 'index.db'),
      CODERAG_DOCS_INCLUDE: path.join(dir, 'docs', '**', '*.md'),
      CODERAG_CODE_INCLUDE: path.join(dir, 'src', '**', '*.ts'),
      ...extra,
    });
    await proc.waitForStderr(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/);
    await proc.waitForStderr(/Startup sync complete/);
    const url = `http://127.0.0.1:${String(port)}/mcp`;
    const session = (await initializeSession(url, { token: TOKEN })).sessionId ?? '';
    return { url, session };
  }

  async function search(url: string, session: string, query: string): Promise<string> {
    const reply = await postJsonRpc(
      url,
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search', arguments: { query, mode: 'keyword' } } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': session } },
    );
    return (reply.message as { result?: { content?: { text: string }[] } }).result?.content?.[0]?.text ?? '';
  }

  it('watches by default: a file created while the server runs becomes searchable', async () => {
    const { url, session } = await start({});
    expect(proc?.stderr()).toMatch(/Watching directory: .*src/);
    writeFileSync(path.join(dir, 'src', 'fresh.ts'), 'export function quokkahandler(): number { return 1; }\n');
    const deadline = Date.now() + 15000;
    let out = '';
    while (Date.now() < deadline) {
      out = await search(url, session, 'quokkahandler');
      if (out.includes('fresh.ts')) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(out).toContain('fresh.ts');
  }, 40000);

  it('CODERAG_WATCH=0 turns the watcher off', async () => {
    const { url, session } = await start({ CODERAG_WATCH: '0' });
    writeFileSync(path.join(dir, 'src', 'fresh.ts'), 'export function quokkahandler(): number { return 1; }\n');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(proc?.stderr()).not.toContain('Watching directory');
    expect(await search(url, session, 'quokkahandler')).not.toContain('fresh.ts');
  }, 40000);
});
