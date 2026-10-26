import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeSession } from '@mcp-servers/http-host/testing';

vi.mock('../../../src/indexer/sync.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/indexer/sync.js')>();
  return { ...original, runStartupSync: vi.fn().mockResolvedValue(undefined) };
});

import { runStartupSync } from '../../../src/indexer/sync.js';
import { activateCodeRagServer, deactivateCodeRagServer, type CodeRagServerInstance } from '../../../src/embedded.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-embedded-sync-test');
const TOKEN = `sync-token-${'s'.repeat(32)}`;
const silent = { debug: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined };

function vsConfig(): { get: (key: string) => unknown } {
  const values: Record<string, unknown> = {
    embeddingUrl: 'http://127.0.0.1:9/v1',
    embeddingModel: 'test-model',
    dbPath: ':memory:',
    embeddingDim: 4,
  };
  return { get: (key: string) => values[key] };
}

describe('embedded coderag startup sync', () => {
  let instance: CodeRagServerInstance | undefined;

  afterEach(async () => {
    if (instance) await deactivateCodeRagServer(instance);
    instance = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.mocked(runStartupSync).mockClear();
  });

  it('runs once, on the first session, and not again for later sessions', async () => {
    mkdirSync(tmpDir, { recursive: true });
    instance = await activateCodeRagServer({ vsCodeConfig: vsConfig(), workspaceFolders: [tmpDir], port: 0, authToken: TOKEN, logger: silent });
    const url = `http://${instance.host}:${String(instance.port)}/mcp`;

    expect(runStartupSync).not.toHaveBeenCalled();

    expect((await initializeSession(url, { token: TOKEN })).status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runStartupSync).toHaveBeenCalledTimes(1);

    expect((await initializeSession(url, { token: TOKEN })).status).toBe(200);
    expect((await initializeSession(url, { token: TOKEN })).status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runStartupSync).toHaveBeenCalledTimes(1);
  });

  it('does not start a sync for unauthenticated attempts', async () => {
    mkdirSync(tmpDir, { recursive: true });
    instance = await activateCodeRagServer({ vsCodeConfig: vsConfig(), workspaceFolders: [tmpDir], port: 0, authToken: TOKEN, logger: silent });
    const url = `http://${instance.host}:${String(instance.port)}/mcp`;
    expect((await initializeSession(url)).status).toBe(401);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runStartupSync).not.toHaveBeenCalled();
  });

  it('hands the sync a logger that is not bound to any session', async () => {
    mkdirSync(tmpDir, { recursive: true });
    instance = await activateCodeRagServer({ vsCodeConfig: vsConfig(), workspaceFolders: [tmpDir], port: 0, authToken: TOKEN, logger: silent });
    await initializeSession(`http://${instance.host}:${String(instance.port)}/mcp`, { token: TOKEN });
    await new Promise((resolve) => setImmediate(resolve));
    const passedLogger = vi.mocked(runStartupSync).mock.calls[0]?.[5];
    expect(passedLogger).toBe(silent);
  });
});
