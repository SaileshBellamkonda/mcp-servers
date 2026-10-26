import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateCodeRagServer, deactivateCodeRagServer, type CodeRagServerInstance } from '../../../src/embedded.js';
import { connectOutcome, externalIPv4 } from '../../fixtures/standalone-process.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../../../src');
const tmpDir = path.join(__dirname, '../../../.tmp-loopback-test');
const TOKEN = `loopback-token-${'l'.repeat(32)}`;
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

describe('embedded coderag server network exposure', () => {
  let instance: CodeRagServerInstance | undefined;

  afterEach(async () => {
    if (instance) await deactivateCodeRagServer(instance);
    instance = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function start(): Promise<number> {
    mkdirSync(tmpDir, { recursive: true });
    instance = await activateCodeRagServer({ vsCodeConfig: vsConfig(), workspaceFolders: [tmpDir], port: 0, authToken: TOKEN, logger: silent });
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
