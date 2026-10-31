import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeSession, postJsonRpc } from '@mcp-servers/http-host/testing';
import { importedSpecifiers } from '../../fixtures/bundle-imports.ts';
import { TOKEN, freePort, spawnStandalone, type StandaloneProcess } from '../../fixtures/standalone-process.ts';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outdir = path.join(packageRoot, '.tmp-bundle-test');
const OUTPUTS = ['standalone.js', 'embedded.js'];
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Package name of a bare specifier, or undefined for relative paths and Node built-ins. */
function externalPackage(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined;
  if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('server bundle (shared packages inlined at build time)', () => {
  /** Every module specifier the built `name` loads at run time. */
  const importsOf = (name: string): string[] => importedSpecifiers(readFileSync(path.join(outdir, name), 'utf8'));

  beforeAll(() => {
    rmSync(outdir, { recursive: true, force: true });
    // The package's own `bundle` script, redirected to a temporary directory.
    execFileSync('pnpm', ['run', 'bundle', '--out-dir', outdir], { cwd: packageRoot, stdio: 'pipe' });
  }, 60000);

  afterAll(() => {
    rmSync(outdir, { recursive: true, force: true });
  });

  it('emits standalone.js (with its hashbang) and embedded.js plus source maps', () => {
    for (const name of ['standalone.js', 'embedded.js', 'standalone.js.map', 'embedded.js.map']) {
      expect(existsSync(path.join(outdir, name)), name).toBe(true);
    }
    expect(readFileSync(path.join(outdir, 'standalone.js'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('leaves no @mcp-servers/* import, require or dynamic import in the output', () => {
    for (const name of OUTPUTS) {
      const text = readFileSync(path.join(outdir, name), 'utf8');
      expect(text, name).not.toMatch(/\b(?:from|import|require)\s*\(?\s*["']@mcp-servers\//);
      for (const specifier of importsOf(name)) {
        expect(specifier.startsWith('@mcp-servers/'), specifier).toBe(false);
      }
    }
  });

  it('only imports Node built-ins and packages declared in dependencies', () => {
    const declared = new Set([
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]);
    const used = new Set<string>();
    for (const name of OUTPUTS) {
      for (const specifier of importsOf(name)) {
        const pkg = externalPackage(specifier);
        if (pkg !== undefined) used.add(pkg);
      }
    }
    expect([...used].filter((p) => !declared.has(p))).toEqual([]);
    // The inlined shared code's third-party imports are real dependencies of this package.
    for (const needed of ['hono', '@hono/node-server', '@modelcontextprotocol/server', '@modelcontextprotocol/hono']) {
      expect(declared.has(needed), needed).toBe(true);
    }
  });

  it('inlines the http-host implementation', () => {
    const text = readFileSync(path.join(outdir, 'standalone.js'), 'utf8');
    expect(text).toContain('function bearerAuth');
    expect(text).toContain('function startMcpHttpServer');
  });

  describe('smoke run of the bundled standalone.js', () => {
    let dir: string;
    let proc: StandaloneProcess | undefined;

    beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'coderag-bundle-'));
    });

    afterAll(async () => {
      proc?.kill();
      await proc?.exited;
      rmSync(dir, { recursive: true, force: true });
    });

    it('rejects anonymous requests, serves an authenticated initialize and exits 0 on SIGTERM', async () => {
      const port = await freePort();
      proc = spawnStandalone(
        {
          MCP_TRANSPORT: 'http',
          MCP_HTTP_PORT: String(port),
          MCP_AUTH_TOKEN: TOKEN,
          CODERAG_EMBEDDING_URL: 'http://127.0.0.1:9/v1',
          CODERAG_EMBEDDING_MODEL: 'bundle-smoke-model',
          CODERAG_EMBEDDING_DIM: '4',
          CODERAG_DB_PATH: path.join(dir, 'index.db'),
          CODERAG_DOCS_INCLUDE: path.join(dir, 'docs', '**', '*.md'),
          CODERAG_CODE_INCLUDE: path.join(dir, 'src', '**', '*.ts'),
        },
        path.join(outdir, 'standalone.js'),
      );
      await proc.waitForStderr(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/);
      const url = `http://127.0.0.1:${String(port)}/mcp`;

      expect((await initializeSession(url)).status).toBe(401);
      const session = await initializeSession(url, { token: TOKEN });
      expect(session.status).toBe(200);
      const reply = await postJsonRpc(
        url,
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': session.sessionId ?? '' } },
      );
      expect(JSON.stringify(reply.message)).toContain('get_index_status');

      proc.child.kill('SIGTERM');
      expect((await proc.exited).code).toBe(0);
    }, 60000);
  });
});
