import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('standalone coderag over stdio', () => {
  let dir: string;
  let child: ChildProcess | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-stdio-handshake-'));
    mkdirSync(path.join(dir, 'docs'));
    mkdirSync(path.join(dir, 'src'));
  });

  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  function waitFor(read: () => string, pattern: RegExp, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        if (pattern.test(read())) resolve();
        else if (Date.now() - started > timeoutMs) reject(new Error(`timeout waiting for ${String(pattern)}:\n${read()}`));
        else setTimeout(tick, 25);
      };
      tick();
    });
  }

  it('does not start the startup sync until the client has completed the handshake', async () => {
    child = spawn(process.execPath, ['--conditions=@mcp-servers/source', 'src/standalone.ts'], {
      cwd: packageRoot,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        MCP_TRANSPORT: 'stdio',
        CODERAG_EMBEDDING_URL: 'http://127.0.0.1:9/v1',
        CODERAG_EMBEDDING_MODEL: 'handshake-model',
        CODERAG_EMBEDDING_DIM: '4',
        CODERAG_DB_PATH: path.join(dir, 'index.db'),
        CODERAG_DOCS_INCLUDE: path.join(dir, 'docs', '**', '*.md'),
        CODERAG_CODE_INCLUDE: path.join(dir, 'src', '**', '*.ts'),
        CODERAG_WATCH: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    await waitFor(() => stderr, /CodeRAG MCP Server ready/);
    // Give a sync that was scheduled right after connect the chance to start.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stderr).not.toMatch(/Startup sync:/);

    child.stdin?.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'handshake-test', version: '1.0.0' } },
    })}\n`);
    await waitFor(() => stdout, /"id":1/);
    expect(stderr).not.toMatch(/Startup sync:/);

    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await waitFor(() => stderr, /Startup sync complete/);
  });
});
