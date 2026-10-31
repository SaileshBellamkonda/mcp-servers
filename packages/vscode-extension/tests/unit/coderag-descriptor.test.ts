import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleLoader } from '../../src/core/module-loader';
import type { ActivationContext, AvailabilityContext, ServerLogger } from '../../src/core/server-descriptor';
import { createCodeRagDescriptor, type CodeRagEnvironment } from '../../src/servers/coderag-descriptor';
import { callArg } from './call-args';

type Probe = { ok: true } | { ok: false; reason: string; needs?: 'fts5' | 'node' };

const logger: ServerLogger = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
const TOKEN = 'a'.repeat(64);

interface Options {
  probe?: Probe;
  storage?: string | undefined;
  remote?: boolean;
  apiKey?: string | undefined;
  settings?: Record<string, unknown>;
  loadFails?: Error;
}

function setup(options: Options = {}) {
  const probeCodeRagSupport = vi.fn((_options: { nativeModulesDir?: string }): Probe => options.probe ?? { ok: true });
  const instance = { port: 3100, host: '127.0.0.1', close: vi.fn(() => Promise.resolve()) };
  const activateCodeRagServer = vi.fn((_options: Record<string, unknown>) => Promise.resolve(instance));
  const loadModule = vi.fn(() =>
    options.loadFails ? Promise.reject(options.loadFails) : Promise.resolve({ probeCodeRagSupport, activateCodeRagServer })
  ) as unknown as ModuleLoader & ReturnType<typeof vi.fn>;
  const settings = options.settings ?? {};
  const config = {
    get: <T>(section: string, key: string, fallback: T): T => {
      const id = `${section}.${key}`;
      return Object.hasOwn(settings, id) ? (settings[id] as T) : fallback;
    },
  };
  const environment: CodeRagEnvironment = {
    nativeModulesDir: '/ext/dist/native',
    storageDir: () => ('storage' in options ? options.storage : '/storage'),
    readApiKey: () => Promise.resolve(options.apiKey),
    isRemote: () => options.remote ?? false,
    nodeVersion: '22.13.0',
  };
  const descriptor = createCodeRagDescriptor(environment);
  const availability: AvailabilityContext = { workspaceFolders: ['/work'], config, loadModule };
  const activation = (overrides: Partial<ActivationContext> = {}): ActivationContext => ({
    serverId: 'coderag',
    port: 3100,
    authToken: TOKEN,
    workspaceFolders: ['/work/a', '/work/b'],
    logger,
    config,
    loadModule,
    ...overrides,
  });
  return { descriptor, environment, probeCodeRagSupport, activateCodeRagServer, instance, loadModule, availability, activation };
}

describe('coderag descriptor', () => {
  it('describes the CodeRAG server', () => {
    const { descriptor } = setup();
    expect(descriptor).toMatchObject({ id: 'coderag', label: 'CodeRAG', settingsSection: 'mcpServers.coderag', defaultPort: 3100, requiresWorkspace: true });
  });

  it('restarts for every setting that changes the index or where data goes, but not for autoStart', () => {
    const { descriptor } = setup();
    expect(descriptor.restartSettings).toEqual(
      expect.arrayContaining(['embeddingUrl', 'embeddingModel', 'embeddingDim', 'embedMaxChars', 'chunkSize', 'topK', 'docsInclude', 'docsExclude', 'codeInclude', 'codeExclude', 'useGitignore', 'allowedRoots', 'watch', 'toolset'])
    );
    expect(descriptor.restartSettings).not.toContain('autoStart');
    expect(descriptor.restartSettings).not.toContain('port');
  });

  describe('isAvailable', () => {
    it('is available when the probe passes, probing with the bundle native directory through the module loader', async () => {
      const t = setup();
      await expect(t.descriptor.isAvailable(t.availability)).resolves.toEqual({ available: true });
      expect(t.loadModule).toHaveBeenCalledWith('@mcp-servers/server-coderag/embedded');
      expect(t.probeCodeRagSupport).toHaveBeenCalledWith({ nativeModulesDir: '/ext/dist/native' });
    });

    it('probes once per session, whatever the result', async () => {
      const ok = setup();
      await ok.descriptor.isAvailable(ok.availability);
      await ok.descriptor.isAvailable(ok.availability);
      expect(ok.probeCodeRagSupport).toHaveBeenCalledOnce();
      expect(ok.loadModule).toHaveBeenCalledOnce();
      const failing = setup({ probe: { ok: false, reason: 'x' } });
      await failing.descriptor.isAvailable(failing.availability);
      await failing.descriptor.isAvailable(failing.availability);
      expect(failing.probeCodeRagSupport).toHaveBeenCalledOnce();
    });

    it('shares one probe between concurrent callers', async () => {
      const t = setup();
      await Promise.all([t.descriptor.isAvailable(t.availability), t.descriptor.isAvailable(t.availability)]);
      expect(t.probeCodeRagSupport).toHaveBeenCalledOnce();
    });

    it('Node too old or without node:sqlite: asks for VS Code 1.101+ (Node 22.14+) and names the host Node version', async () => {
      const t = setup({ probe: { ok: false, reason: 'Node.js 22.13.0 is too old', needs: 'node' } });
      const result = await t.descriptor.isAvailable(t.availability);
      expect(result).toEqual({
        available: false,
        reason: 'Needs VS Code 1.101 or newer (Node.js 22.14+ with node:sqlite); this host runs Node.js 22.13.0',
      });
    });

    it('missing FTS5 on a local VS Code: needs VS Code 1.103 or newer', async () => {
      const t = setup({ probe: { ok: false, reason: 'no such module: fts5', needs: 'fts5' } });
      await expect(t.descriptor.isAvailable(t.availability)).resolves.toEqual({
        available: false,
        reason: "Needs VS Code 1.103 or newer (this build's SQLite lacks FTS5)",
      });
    });

    it('missing FTS5 on a remote host: needs Node >= 22.16 on the remote', async () => {
      const t = setup({ remote: true, probe: { ok: false, reason: 'no such module: fts5', needs: 'fts5' } });
      const result = await t.descriptor.isAvailable(t.availability);
      expect(result).toMatchObject({ available: false });
      expect(result.available === false && result.reason).toBe("Needs Node.js 22.16 or newer on the remote host (this host's SQLite lacks FTS5)");
    });

    it('native load failures show the probe reason', async () => {
      const t = setup({ probe: { ok: false, reason: 'sqlite-vec is unavailable (load or vec_version() failed): no vec0.so' } });
      await expect(t.descriptor.isAvailable(t.availability)).resolves.toEqual({
        available: false,
        reason: 'sqlite-vec is unavailable (load or vec_version() failed): no vec0.so',
      });
    });

    it('a module that cannot be loaded makes it unavailable with the error, without throwing', async () => {
      const t = setup({ loadFails: new Error('Cannot find module x') });
      await expect(t.descriptor.isAvailable(t.availability)).resolves.toEqual({
        available: false,
        reason: 'CodeRAG could not be loaded: Cannot find module x',
      });
    });

    it('a probe that throws makes it unavailable instead of crashing the start', async () => {
      const t = setup();
      t.probeCodeRagSupport.mockImplementation(() => {
        throw new Error('segfault-ish');
      });
      await expect(t.descriptor.isAvailable(t.availability)).resolves.toEqual({ available: false, reason: 'CodeRAG could not be loaded: segfault-ish' });
    });

    it('without workspace storage asks to open a folder (and does not probe)', async () => {
      const t = setup({ storage: undefined });
      await expect(t.descriptor.isAvailable(t.availability)).resolves.toEqual({ available: false, reason: 'Open a folder to use CodeRAG' });
      expect(t.probeCodeRagSupport).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    let storage: string;
    beforeEach(() => {
      storage = path.join(mkdtempSync(path.join(tmpdir(), 'coderag-descriptor-')), 'workspaceStorage', 'abc');
    });
    afterEach(() => {
      rmSync(path.dirname(path.dirname(storage)), { recursive: true, force: true });
    });

    it('starts the server on all folders with the token, port, native directory and a DB in the workspace storage (created)', async () => {
      const t = setup({ storage });
      const instance = await t.descriptor.activate(t.activation());
      expect(t.loadModule).toHaveBeenCalledWith('@mcp-servers/server-coderag/embedded');
      const options = t.activateCodeRagServer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(options).toMatchObject({
        workspaceFolders: ['/work/a', '/work/b'],
        port: 3100,
        authToken: TOKEN,
        nativeModulesDir: '/ext/dist/native',
      });
      expect(existsSync(storage)).toBe(true);
      const get = (options['vsCodeConfig'] as { get(key: string): unknown }).get;
      expect(get('dbPath')).toBe(path.join(storage, 'coderag.db'));
      expect(instance).toMatchObject({ port: 3100, host: '127.0.0.1' });
      expect(instance.updateWorkspaceFolders).toBeUndefined();
      await instance.close();
      expect(t.instance.close).toHaveBeenCalledOnce();
    });

    it.runIf(process.platform !== 'win32')('creates the workspace storage directory with mode 0700 (umask 022) and leaves an existing one alone', async () => {
      const previous = process.umask(0o022);
      try {
        const t = setup({ storage });
        await t.descriptor.activate(t.activation());
        expect(statSync(storage).mode & 0o777).toBe(0o700);

        const existing = path.join(path.dirname(storage), 'existing');
        mkdirSync(existing, { mode: 0o755 });
        chmodSync(existing, 0o755);
        const again = setup({ storage: existing });
        await again.descriptor.activate(again.activation());
        expect(statSync(existing).mode & 0o777).toBe(0o755);
      } finally {
        process.umask(previous);
      }
    });

    it('passes watch (default on) and toolset (default standard) as server options', async () => {
      const t = setup({ storage });
      await t.descriptor.activate(t.activation());
      const options = t.activateCodeRagServer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(options['watch']).toBe(true);
      expect(options['toolset']).toBe('standard');
    });

    it('passes the configured watch and toolset settings', async () => {
      const t = setup({ storage, settings: { 'mcpServers.coderag.watch': false, 'mcpServers.coderag.toolset': 'all' } });
      await t.descriptor.activate(t.activation());
      const options = t.activateCodeRagServer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(options['watch']).toBe(false);
      expect(options['toolset']).toBe('all');
    });

    it('does not expose watch or toolset through the vsCodeConfig the server reads', async () => {
      const t = setup({ storage, settings: { 'mcpServers.coderag.watch': false, 'mcpServers.coderag.toolset': 'all' } });
      await t.descriptor.activate(t.activation());
      const { get } = callArg<{ vsCodeConfig: { get(key: string): unknown } }>(t.activateCodeRagServer).vsCodeConfig;
      expect(get('watch')).toBeUndefined();
      expect(get('toolset')).toBeUndefined();
    });

    it('passes the API key only through the apiKey option', async () => {
      const t = setup({ storage, apiKey: 'sk-secret-key' });
      await t.descriptor.activate(t.activation());
      const options = t.activateCodeRagServer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(options['apiKey']).toBe('sk-secret-key');
      expect(JSON.stringify(options['vsCodeConfig'])).not.toContain('sk-secret-key');
      expect((options['vsCodeConfig'] as { get(key: string): unknown }).get('embeddingApiKey')).toBeUndefined();
    });

    it('omits apiKey when none is stored', async () => {
      const t = setup({ storage });
      await t.descriptor.activate(t.activation());
      expect(t.activateCodeRagServer.mock.calls[0]?.[0]).not.toHaveProperty('apiKey');
    });

    it('never reads an embeddingApiKey setting, even if someone put one in settings.json', async () => {
      const t = setup({ storage, settings: { 'mcpServers.coderag.embeddingApiKey': 'from-settings-json' } });
      await t.descriptor.activate(t.activation());
      const options = t.activateCodeRagServer.mock.calls[0]?.[0] as { vsCodeConfig: { get(key: string): unknown }; apiKey?: string };
      expect(options.vsCodeConfig.get('embeddingApiKey')).toBeUndefined();
      expect(options.apiKey).toBeUndefined();
    });

    it('exposes the settings of mcpServers.coderag under the keys the server reads; empty values mean "default"', async () => {
      const t = setup({
        storage,
        settings: {
          'mcpServers.coderag.embeddingUrl': 'http://127.0.0.1:11434/v1',
          'mcpServers.coderag.embeddingModel': 'nomic-embed-text',
          'mcpServers.coderag.embeddingDim': 768,
          'mcpServers.coderag.chunkSize': 400,
          'mcpServers.coderag.embedMaxChars': 3000,
          'mcpServers.coderag.topK': 7,
          'mcpServers.coderag.useGitignore': false,
          'mcpServers.coderag.docsInclude': ['docs/**/*.md'],
          'mcpServers.coderag.docsExclude': [],
          'mcpServers.coderag.codeInclude': [],
          'mcpServers.coderag.codeExclude': ['**/dist/**'],
          'mcpServers.coderag.allowedRoots': [],
          'mcpServers.other.thing': 'ignored',
        },
      });
      await t.descriptor.activate(t.activation());
      const { get } = callArg<{ vsCodeConfig: { get(key: string): unknown } }>(t.activateCodeRagServer).vsCodeConfig;
      expect(get('embeddingUrl')).toBe('http://127.0.0.1:11434/v1');
      expect(get('embeddingModel')).toBe('nomic-embed-text');
      expect(get('embeddingDim')).toBe(768);
      expect(get('chunkSize')).toBe(400);
      expect(get('embedMaxChars')).toBe(3000);
      expect(get('topK')).toBe(7);
      expect(get('useGitignore')).toBe(false);
      expect(get('docsInclude')).toEqual(['docs/**/*.md']);
      expect(get('codeExclude')).toEqual(['**/dist/**']);
      // VS Code reports an unset array setting as []: that must fall back to the server defaults, not mean "nothing".
      expect(get('docsExclude')).toBeUndefined();
      expect(get('codeInclude')).toBeUndefined();
      expect(get('allowedRoots')).toBeUndefined();
      expect(get('unknownKey')).toBeUndefined();
    });

    it('hands the server the logger it was given, debug output included', async () => {
      const t = setup({ storage });
      await t.descriptor.activate(t.activation());
      const given = callArg<{ logger: Record<string, (data: unknown) => void> }>(t.activateCodeRagServer).logger;
      given['debug']?.('d');
      given['info']?.('i');
      given['warning']?.('w');
      given['error']?.('e');
      expect(logger.debug).toHaveBeenCalledWith('d');
      expect(logger.info).toHaveBeenCalledWith('i');
      expect(logger.warning).toHaveBeenCalledWith('w');
      expect(logger.error).toHaveBeenCalledWith('e');
    });

    it('rejects with the server error (e.g. a missing embedding URL) so the adapter shows it', async () => {
      const t = setup({ storage });
      t.activateCodeRagServer.mockRejectedValueOnce(new Error('mcpServers.coderag.embeddingUrl is required.'));
      await expect(t.descriptor.activate(t.activation())).rejects.toThrow('mcpServers.coderag.embeddingUrl is required');
    });

    it('fails clearly when there is no workspace storage', async () => {
      const t = setup({ storage: undefined });
      await expect(t.descriptor.activate(t.activation())).rejects.toThrow('Open a folder to use CodeRAG');
      expect(t.activateCodeRagServer).not.toHaveBeenCalled();
    });
  });
});
