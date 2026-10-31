import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN, connectOutcome, freePort, spawnStandalone, type StandaloneProcess } from '../../fixtures/standalone-process.ts';

describe('standalone coderag logging', () => {
  let dir: string;
  let proc: StandaloneProcess | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-standalone-logging-'));
    mkdirSync(path.join(dir, 'docs'));
    mkdirSync(path.join(dir, 'src'));
  });

  afterEach(async () => {
    proc?.kill();
    await proc?.exited;
    proc = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(extra: Record<string, string>): Promise<number> {
    const port = await freePort();
    proc = spawnStandalone({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      CODERAG_EMBEDDING_URL: 'http://127.0.0.1:9/v1',
      CODERAG_EMBEDDING_MODEL: 'log-model',
      CODERAG_EMBEDDING_DIM: '4',
      CODERAG_DB_PATH: path.join(dir, 'index.db'),
      CODERAG_DOCS_INCLUDE: path.join(dir, 'docs', '**', '*.md'),
      CODERAG_CODE_INCLUDE: path.join(dir, 'src', '**', '*.ts'),
      CODERAG_WATCH: '0',
      ...extra,
    });
    return port;
  }

  /** Resolves once the server accepts connections, i.e. has started (and logged what it logs at startup). */
  async function untilListening(port: number): Promise<void> {
    await vi.waitFor(async () => {
      expect(await connectOutcome('127.0.0.1', port)).toBe('connected');
    }, { timeout: 20000, interval: 50 });
  }

  it('writes timestamped entries to LOG_FILE (creating its directory) and nothing to stderr', async () => {
    const file = path.join(dir, 'logs', 'coderag.log');
    await start({ LOG_FILE: file });
    await proc?.waitForLog(/Startup sync complete/);

    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[INFO\] \[http-host\] MCP HTTP server listening/m);
    expect(text).toMatch(/\[INFO\] \[coderag\] CodeRAG MCP Server ready \(model: log-model/);
    expect(proc?.stderr()).toBe('');
  }, 30000);

  it('writes nothing anywhere when LOG_FILE is not set', async () => {
    const port = await start({ LOG_FILE: '' });
    await untilListening(port);

    expect(proc?.log()).toBe('');
    expect(proc?.stderr()).toBe('');
  }, 30000);

  it('filters entries by LOG_LEVEL', async () => {
    const file = path.join(dir, 'coderag.log');
    const port = await start({ LOG_FILE: file, LOG_LEVEL: 'error' });
    await untilListening(port);

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('');
    expect(proc?.stderr()).toBe('');
  }, 30000);

  it('exits with a FATAL message on stderr when LOG_LEVEL is invalid', async () => {
    await start({ LOG_LEVEL: 'loud' });
    const { code } = (await proc?.exited) ?? { code: null };

    expect(code).not.toBe(0);
    expect(proc?.stderr()).toMatch(/\[FATAL\].*LOG_LEVEL.*loud/);
  }, 30000);
});
