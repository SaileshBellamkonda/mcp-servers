import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateGitServer, deactivateGitServer, type GitServerInstance } from '../../../src/embedded.js';
import { TestRepository } from '../../fixtures/test-repo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = `loopback-token-${'z'.repeat(32)}`;
const silent = { info: () => undefined, warning: () => undefined, error: () => undefined };
const srcDir = path.join(__dirname, '../../../src');

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

describe('entry points never open a listener themselves', () => {
  for (const file of ['standalone.ts', 'embedded.ts']) {
    it(`${file} delegates HTTP to the secured host`, () => {
      const source = readFileSync(path.join(srcDir, file), 'utf8');
      expect(source).not.toMatch(/\bserve\(/);
      expect(source).not.toContain('@hono/node-server');
      expect(source).toContain('startMcpHttpServer');
    });
  }
});

describe('embedded git server network exposure', () => {
  let repo: TestRepository | undefined;
  let instance: GitServerInstance | undefined;

  afterEach(async () => {
    if (instance) await deactivateGitServer(instance);
    instance = undefined;
    await repo?.cleanup();
    repo = undefined;
  });

  async function start(): Promise<number> {
    repo = await TestRepository.create();
    instance = await activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: TOKEN, logger: silent });
    return instance.port;
  }

  it('listens on the IPv4 loopback address only', async () => {
    await start();
    expect(instance?.host).toBe('127.0.0.1');
  });

  it('refuses connections arriving on a non-loopback interface', async (ctx) => {
    const external = externalIPv4();
    if (!external) ctx.skip();
    const port = await start();
    expect(await connectOutcome('127.0.0.1', port)).toBe('connected');
    expect(await connectOutcome(external ?? '', port)).toBe('refused');
  });
});
