import { describe, it, expect, afterEach } from 'vitest';
import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { activateCodeRagServer, deactivateCodeRagServer } from '../../../src/embedded.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../../../src');
const tmpDir = path.join(__dirname, '../../../.tmp-loopback-test');

function vsConfig(): { get: (key: string) => unknown } {
  const values: Record<string, unknown> = {
    embeddingUrl: 'http://127.0.0.1:9/v1',
    embeddingModel: 'test-model',
    dbPath: ':memory:',
    embeddingDim: 4,
  };
  return { get: (key: string) => values[key] };
}

function externalIPv4(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return undefined;
}

function connectOutcome(host: string, port: number): Promise<'connected' | 'refused' | 'other'> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 3000 });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('error', (err: NodeJS.ErrnoException) => { resolve(err.code === 'ECONNREFUSED' ? 'refused' : 'other'); });
    socket.once('timeout', () => { socket.destroy(); resolve('other'); });
  });
}

describe('every serve() call pins the bind address', () => {
  for (const file of ['standalone.ts', 'embedded.ts']) {
    it(`${file} passes a hostname to serve()`, () => {
      const source = readFileSync(path.join(srcDir, file), 'utf8');
      const calls = [...source.matchAll(/\bserve\(\s*\{([^}]*)\}/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[1]).toMatch(/\bhostname\b/);
      }
    });
  }
});

describe('embedded coderag server network exposure', () => {
  let instance: Awaited<ReturnType<typeof activateCodeRagServer>> | undefined;

  afterEach(async () => {
    if (instance) await deactivateCodeRagServer(instance);
    instance = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function start(): Promise<number> {
    mkdirSync(tmpDir, { recursive: true });
    instance = await activateCodeRagServer(vsConfig(), [tmpDir], 0);
    if (!instance.httpServer.listening) await once(instance.httpServer, 'listening');
    return (instance.httpServer.address() as AddressInfo).port;
  }

  it('listens on the IPv4 loopback address only', async () => {
    await start();
    const address = instance?.httpServer.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
  });

  it('refuses connections arriving on a non-loopback interface', async (ctx) => {
    const external = externalIPv4();
    if (!external) ctx.skip();
    const port = await start();
    expect(await connectOutcome('127.0.0.1', port)).toBe('connected');
    expect(await connectOutcome(external ?? '', port)).toBe('refused');
  });
});
