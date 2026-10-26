import { describe, it, expect, vi, afterEach } from 'vitest';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

vi.mock('../../../src/indexer/sync.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/indexer/sync.js')>();
  return { ...original, runStartupSync: vi.fn().mockResolvedValue(undefined) };
});

import { runStartupSync } from '../../../src/indexer/sync.js';
import { activateCodeRagServer, deactivateCodeRagServer } from '../../../src/embedded.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-embedded-sync-test');

function vsConfig(): { get: (key: string) => unknown } {
  const values: Record<string, unknown> = {
    embeddingUrl: 'http://127.0.0.1:9/v1',
    embeddingModel: 'test-model',
    dbPath: ':memory:',
    embeddingDim: 4,
  };
  return { get: (key: string) => values[key] };
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
});

async function openSession(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: INITIALIZE,
  });
  await response.text();
  return response.status;
}

describe('embedded coderag startup sync', () => {
  let instance: Awaited<ReturnType<typeof activateCodeRagServer>> | undefined;

  afterEach(async () => {
    if (instance) await deactivateCodeRagServer(instance);
    instance = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.mocked(runStartupSync).mockClear();
  });

  it('runs once, on the first session, and not again for later sessions', async () => {
    mkdirSync(tmpDir, { recursive: true });
    instance = await activateCodeRagServer(vsConfig(), [tmpDir], 0);
    if (!instance.httpServer.listening) await once(instance.httpServer, 'listening');
    const port = (instance.httpServer.address() as AddressInfo).port;

    expect(runStartupSync).not.toHaveBeenCalled();

    expect(await openSession(port)).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runStartupSync).toHaveBeenCalledTimes(1);

    expect(await openSession(port)).toBe(200);
    expect(await openSession(port)).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runStartupSync).toHaveBeenCalledTimes(1);
  });
});
