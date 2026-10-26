import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { deriveServerToken } from '../../src/core/server-token';
import { CODERAG_API_KEY_SECRET } from '../../src/integration-commands';
import { makeContext, type TestContext } from './test-context';

// The real loader holds the literal import() the bundler needs; the extension is tested against a fake git module.
const git = vi.hoisted(() => {
  const state = { instances: [] as { port: number; host: string; close: () => Promise<void>; updateAllowedRepositories: (folders: string[]) => void }[], nextPort: 3000 };
  const activateGitServer = vi.fn((options: { port: number }) => {
    const instance = {
      port: options.port === 0 ? state.nextPort++ : options.port,
      host: '127.0.0.1',
      close: vi.fn(() => Promise.resolve()),
      updateAllowedRepositories: vi.fn(),
    };
    state.instances.push(instance);
    return Promise.resolve(instance);
  });
  return { state, activateGitServer };
});
const rag = vi.hoisted(() => {
  type Probe = { ok: true } | { ok: false; reason: string; needs?: 'fts5' | 'node' };
  const state = {
    instances: [] as { port: number; host: string; close: () => Promise<void> }[],
    nextPort: 3100,
    probe: { ok: true } as Probe,
  };
  const probeCodeRagSupport = vi.fn(() => state.probe);
  const activateCodeRagServer = vi.fn((options: { port: number }) => {
    const instance = {
      port: options.port === 0 ? state.nextPort++ : options.port,
      host: '127.0.0.1',
      close: vi.fn(() => Promise.resolve()),
    };
    state.instances.push(instance);
    return Promise.resolve(instance);
  });
  return { state, probeCodeRagSupport, activateCodeRagServer };
});
vi.mock('../../src/servers/module-loader', () => ({
  loadServerModule: vi.fn((specifier: string) =>
    Promise.resolve(
      specifier === '@mcp-servers/server-coderag/embedded'
        ? { probeCodeRagSupport: rag.probeCodeRagSupport, activateCodeRagServer: rag.activateCodeRagServer }
        : { activateGitServer: git.activateGitServer }
    )
  ),
}));

import { activate, deactivate } from '../../src/extension';

type Item = vscode.TreeItem;
type Disposable = { dispose: () => void };

interface Provider {
  getChildren(): { id: string; getInfo(): { state: string; port?: number; reason?: string } }[];
  getTreeItem(element: unknown): Item;
}

function treeProvider(): Provider {
  const call = vi.mocked(vscode.window.createTreeView).mock.calls[0];
  return (call?.[1] as { treeDataProvider: Provider }).treeDataProvider;
}
function gitState(): string | undefined {
  return treeProvider().getChildren()[0]?.getInfo().state;
}
function gitReason(): string | undefined {
  return (treeProvider().getChildren()[0]?.getInfo() as { reason?: string } | undefined)?.reason;
}
async function until(state: string): Promise<void> {
  await vi.waitFor(() => {
    expect(gitState()).toBe(state);
  });
}
function serverInfo(id: string): { state: string; port?: number; reason?: string } | undefined {
  return treeProvider().getChildren().find((child) => child.id === id)?.getInfo();
}
async function untilServer(id: string, state: string): Promise<void> {
  await vi.waitFor(() => {
    expect(serverInfo(id)?.state).toBe(state);
  });
}
function setting(key: string, value: unknown): void {
  (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings({ [key]: value });
}
const test = (vscode as unknown as { __test: { mcpProviders(): ReadonlyMap<string, vscode.McpServerDefinitionProvider>; setFolders(p: string[]): void; fireConfigChange(k: string[]): void; fireFolderChange(): void; listenerCounts(): { config: number; folders: number }; reset(): void } }).__test;
function handler(id: string): (arg?: unknown) => Promise<void> {
  const call = vi.mocked(vscode.commands.registerCommand).mock.calls.find(([name]) => name === id);
  return call?.[1] as (arg?: unknown) => Promise<void>;
}
function outputLines(): string[] {
  const channel = vi.mocked(vscode.window.createOutputChannel).mock.results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };
  return channel.appendLine.mock.calls.map((c) => String(c[0]));
}
function ragOptions(call = 0): Record<string, unknown> {
  return (rag.activateCodeRagServer.mock.calls[call]?.[0] ?? {}) as Record<string, unknown>;
}
function gitToken(): string {
  return (git.activateGitServer.mock.calls[0]?.[0] as unknown as { authToken: string }).authToken;
}
function contextKey(key: string): unknown {
  const calls = vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'setContext' && c[1] === key);
  return calls[calls.length - 1]?.[2];
}

describe('extension', () => {
  let ctx: TestContext;
  let root: string;

  beforeEach(() => {
    test.reset();
    git.state.instances.length = 0;
    git.state.nextPort = 3000;
    rag.state.instances.length = 0;
    rag.state.nextPort = 3100;
    rag.state.probe = { ok: true };
    test.setFolders(['/work/repo']);
    root = mkdtempSync(path.join(tmpdir(), 'extension-test-'));
    ctx = makeContext(root);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await deactivate();
    ctx.subscriptions.forEach((d) => {
      d.dispose();
    });
    rmSync(root, { recursive: true, force: true });
  });

  describe('activation', () => {
    it('registers every disposable in context.subscriptions', () => {
      activate(ctx as never);
      const channel = vi.mocked(vscode.window.createOutputChannel).mock.results[0]?.value as Disposable & { dispose: ReturnType<typeof vi.fn> };
      const treeView = vi.mocked(vscode.window.createTreeView).mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
      const statusItem = vi.mocked(vscode.window.createStatusBarItem).mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
      const commandDisposables = vi.mocked(vscode.commands.registerCommand).mock.results.map((r) => r.value as { dispose: ReturnType<typeof vi.fn> });
      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('MCP Servers');
      expect(commandDisposables).toHaveLength(8);
      expect(test.listenerCounts()).toEqual({ config: 1, folders: 1 });

      ctx.subscriptions.forEach((d) => {
        d.dispose();
      });

      expect(channel.dispose).toHaveBeenCalled();
      expect(treeView.dispose).toHaveBeenCalled();
      expect(statusItem.dispose).toHaveBeenCalled();
      commandDisposables.forEach((d) => {
        expect(d.dispose).toHaveBeenCalled();
      });
      expect(test.listenerCounts()).toEqual({ config: 0, folders: 0 });
    });

    it('creates the "mcpServers" tree view with the git and coderag servers in it', () => {
      activate(ctx as never);
      expect(vi.mocked(vscode.window.createTreeView).mock.calls[0]?.[0]).toBe('mcpServers');
      expect(treeProvider().getChildren().map((child) => child.id)).toEqual(['git', 'coderag']);
    });

    it('auto-starts the git server by default and reports running with a port', async () => {
      activate(ctx as never);
      await until('running');
      expect(git.activateGitServer).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceFolders: ['/work/repo'], port: 3000, authToken: expect.stringMatching(/^[0-9a-f]{64}$/) as string })
      );
      expect(treeProvider().getChildren()[0]?.getInfo().port).toBe(3000);
    });

    it('does not start when autoStart is off', async () => {
      setting('mcpServers.git.autoStart', false);
      activate(ctx as never);
      await Promise.resolve();
      expect(gitState()).toBe('stopped');
      expect(git.activateGitServer).not.toHaveBeenCalled();
    });

    it('is unavailable (and starts nothing) without a workspace folder', async () => {
      test.setFolders([]);
      activate(ctx as never);
      await Promise.resolve();
      expect(gitState()).toBe('unavailable');
      expect(gitReason()).toBe('Open a folder to use the Git server');
      expect(git.activateGitServer).not.toHaveBeenCalled();
    });

    it('ignores folders that are not on the file system', async () => {
      (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/virtual', scheme: 'vscode-vfs' }, name: 'v', index: 0 }];
      activate(ctx as never);
      expect(gitState()).toBe('unavailable');
    });

    it('reports a failing auto-start once, with the real reason, and does not leave an unhandled rejection', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      git.activateGitServer.mockRejectedValueOnce(Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:3000'), { code: 'EADDRINUSE' }));
      activate(ctx as never);
      await until('error');
      await new Promise((resolve) => setImmediate(resolve));
      process.off('unhandledRejection', unhandled);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        'Git server failed to start: Port 3000 is already in use (change mcpServers.git.port)'
      );
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('logs to the output channel and never writes the token', async () => {
      activate(ctx as never);
      await until('running');
      const token = (git.activateGitServer.mock.calls[0]?.[0] as unknown as { authToken: string }).authToken;
      const lines = outputLines();
      expect(lines.some((line) => /\[git\] started on 127\.0\.0\.1:3000/.test(line))).toBe(true);
      expect(lines.join('\n')).not.toContain(token);
    });

    it('keeps the context keys of the menus up to date', async () => {
      setting('mcpServers.coderag.autoStart', true);
      activate(ctx as never);
      await until('running');
      await untilServer('coderag', 'running');
      expect(contextKey('mcpServers.anyRunning')).toBe(true);
      expect(contextKey('mcpServers.anyStartable')).toBe(false);
      await handler('mcpServers.stopServer')('coderag');
      await handler('mcpServers.stopServer')();
      expect(contextKey('mcpServers.anyRunning')).toBe(false);
      expect(contextKey('mcpServers.anyStartable')).toBe(true);
    });
  });

  describe('deactivate()', () => {
    it('awaits stopAll: the server is closed (port freed) before it resolves', async () => {
      activate(ctx as never);
      await until('running');
      await deactivate();
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
      expect(gitState()).toBe('stopped');
    });

    it('waits for a start that is still in flight and then closes it', async () => {
      activate(ctx as never);
      expect(gitState()).toBe('starting');
      await deactivate();
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
    });

    it('never throws, even when closing fails, and logs the failure', async () => {
      activate(ctx as never);
      await until('running');
      vi.mocked(git.state.instances[0]?.close as () => Promise<void>).mockRejectedValueOnce(new Error('stuck socket'));
      await expect(deactivate()).resolves.toBeUndefined();
      expect(outputLines().some((l) => l.includes('stuck socket'))).toBe(true);
    });

    it('resolves when the extension was never activated', async () => {
      await expect(deactivate()).resolves.toBeUndefined();
    });

    it('disposing the subscriptions first (as the smoke test does) is safe', async () => {
      activate(ctx as never);
      await until('running');
      ctx.subscriptions.forEach((d) => {
        d.dispose();
      });
      await deactivate();
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
    });
  });

  describe('configuration changes', () => {
    beforeEach(() => {
      // Setting changes are debounced (500 ms); only the timers are faked so setImmediate and promises stay real.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('restarts a running server when its port changed and tells the user', async () => {
      activate(ctx as never);
      await until('running');
      setting('mcpServers.git.port', 4100);
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.advanceTimersByTimeAsync(500);
      await vi.waitFor(() => {
        expect(treeProvider().getChildren()[0]?.getInfo().port).toBe(4100);
      });
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Git server restarted on port 4100');
    });

    it('waits for the settings to settle: several quick changes cause one restart with the final value', async () => {
      activate(ctx as never);
      await until('running');
      setting('mcpServers.git.port', 4100);
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.advanceTimersByTimeAsync(400);
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      setting('mcpServers.git.port', 4101);
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.advanceTimersByTimeAsync(400);
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => {
        expect(treeProvider().getChildren()[0]?.getInfo().port).toBe(4101);
      });
      expect(git.activateGitServer).toHaveBeenCalledTimes(2);
    });

    it('does not restart for autoStart or unrelated settings', async () => {
      activate(ctx as never);
      await until('running');
      setting('mcpServers.git.autoStart', false);
      test.fireConfigChange(['mcpServers.git.autoStart']);
      test.fireConfigChange(['editor.fontSize']);
      await new Promise((resolve) => setImmediate(resolve));
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      expect(git.state.instances[0]?.close).not.toHaveBeenCalled();
    });

    it('does not restart when the port setting is rewritten with the same value', async () => {
      activate(ctx as never);
      await until('running');
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.advanceTimersByTimeAsync(500);
      await new Promise((resolve) => setImmediate(resolve));
      expect(git.activateGitServer).toHaveBeenCalledOnce();
    });

    it('reports a failing restart once', async () => {
      activate(ctx as never);
      await until('running');
      git.activateGitServer.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      setting('mcpServers.git.port', 4100);
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.advanceTimersByTimeAsync(500);
      await until('error');
      await new Promise((resolve) => setImmediate(resolve));
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        'Git server failed to restart: Port 4100 is already in use (change mcpServers.git.port)'
      );
    });

    it('does not retry a failed server when only autoStart changed', async () => {
      git.activateGitServer.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      activate(ctx as never);
      await until('error');
      setting('mcpServers.git.autoStart', true);
      test.fireConfigChange(['mcpServers.git.autoStart']);
      await new Promise((resolve) => setImmediate(resolve));
      expect(gitState()).toBe('error');
      expect(git.activateGitServer).toHaveBeenCalledOnce();
    });

    it('retries a server that failed to start when the port is changed (autoStart on)', async () => {
      git.activateGitServer.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      activate(ctx as never);
      await until('error');
      setting('mcpServers.git.port', 4200);
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.advanceTimersByTimeAsync(500);
      await until('running');
      expect(treeProvider().getChildren()[0]?.getInfo().port).toBe(4200);
    });
  });

  describe('workspace folder changes', () => {
    it('restarts the running git server with the new folders and the token of the new folder set', async () => {
      activate(ctx as never);
      await until('running');
      test.setFolders(['/work/repo', '/work/other']);
      test.fireFolderChange();
      await vi.waitFor(() => {
        expect(git.activateGitServer).toHaveBeenCalledTimes(2);
      });
      await until('running');
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
      expect(git.activateGitServer).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceFolders: ['/work/repo', '/work/other'] }));
      const tokens = git.activateGitServer.mock.calls.map((c) => (c[0] as unknown as { authToken: string }).authToken);
      expect(tokens[1]).not.toBe(tokens[0]);
    });

    it('keeps the token while the folder set stays the same (a folder moves position or another window fires the event)', async () => {
      activate(ctx as never);
      await until('running');
      test.fireFolderChange();
      await new Promise((resolve) => setImmediate(resolve));
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      expect(git.state.instances[0]?.updateAllowedRepositories).toHaveBeenCalledWith(['/work/repo']);
    });

    it('stops the server and shows it as unavailable when the last folder is closed', async () => {
      activate(ctx as never);
      await until('running');
      test.setFolders([]);
      test.fireFolderChange();
      await until('unavailable');
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
      expect(gitReason()).toBe('Open a folder to use the Git server');
    });

    it('starts the server when a folder is opened and autoStart is on', async () => {
      test.setFolders([]);
      activate(ctx as never);
      expect(gitState()).toBe('unavailable');
      test.setFolders(['/work/new']);
      test.fireFolderChange();
      await until('running');
      expect(git.activateGitServer).toHaveBeenCalledWith(expect.objectContaining({ workspaceFolders: ['/work/new'] }));
    });

    it('only makes the server startable when autoStart is off', async () => {
      setting('mcpServers.git.autoStart', false);
      test.setFolders([]);
      activate(ctx as never);
      test.setFolders(['/work/new']);
      test.fireFolderChange();
      await vi.waitFor(() => {
        expect(gitState()).toBe('stopped');
      });
      expect(git.activateGitServer).not.toHaveBeenCalled();
    });

    it('does not restart a server the user stopped when folders change', async () => {
      activate(ctx as never);
      await until('running');
      await handler('mcpServers.stopServer')();
      test.setFolders(['/work/repo', '/work/other']);
      test.fireFolderChange();
      await new Promise((resolve) => setImmediate(resolve));
      expect(gitState()).toBe('stopped');
      expect(git.activateGitServer).toHaveBeenCalledOnce();
    });

    it('reports a failing re-scope once', async () => {
      activate(ctx as never);
      await until('running');
      vi.mocked(git.state.instances[0]?.updateAllowedRepositories as (f: string[]) => void).mockImplementationOnce(() => {
        throw new Error('rescope failed');
      });
      test.fireFolderChange();
      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Git server failed to update its workspace folders: rescope failed');
      });
    });

    it('reports a failing restart after a folder change once', async () => {
      activate(ctx as never);
      await until('running');
      git.activateGitServer.mockRejectedValueOnce(new Error('restart failed'));
      test.setFolders(['/work/other']);
      test.fireFolderChange();
      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Git server failed to update its workspace folders: restart failed');
      });
    });
  });

  describe('CodeRAG', () => {
    const ragSettings = {
      'mcpServers.coderag.autoStart': true,
      'mcpServers.coderag.embeddingUrl': 'http://127.0.0.1:11434/v1',
      'mcpServers.coderag.embeddingModel': 'nomic-embed-text',
    };

    it('is listed, stopped and never probed or started by default: indexing costs, so autoStart is off', async () => {
      activate(ctx as never);
      await until('running');
      expect(serverInfo('coderag')?.state).toBe('stopped');
      expect(rag.probeCodeRagSupport).not.toHaveBeenCalled();
      expect(rag.activateCodeRagServer).not.toHaveBeenCalled();
    });

    it('with autoStart on: probes the bundle native directory, then starts on port 3100 with its own token derived from the workspace token', async () => {
      (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings(ragSettings);
      activate(ctx as never);
      await untilServer('coderag', 'running');
      expect(rag.probeCodeRagSupport).toHaveBeenCalledOnce();
      expect(rag.probeCodeRagSupport).toHaveBeenCalledWith({ nativeModulesDir: expect.stringMatching(/[\\/]native$/) as string });
      expect(ragOptions()).toMatchObject({
        workspaceFolders: ['/work/repo'],
        port: 3100,
        authToken: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      });
      const workspaceToken = [...ctx.secrets.values.values()][0] ?? '';
      expect(ragOptions()['authToken']).toBe(deriveServerToken(workspaceToken, 'coderag'));
      expect(gitToken()).toBe(deriveServerToken(workspaceToken, 'git'));
      expect(ragOptions()['authToken']).not.toBe(gitToken());
      expect(ragOptions()['nativeModulesDir']).toMatch(/native$/);
      expect(serverInfo('coderag')?.port).toBe(3100);
    });

    it('persists the workspace token in SecretStorage (servers only get tokens derived from it)', async () => {
      activate(ctx as never);
      await until('running');
      const secrets = [...ctx.secrets.values.entries()];
      expect(secrets).toHaveLength(1);
      expect(secrets[0]?.[0]).toMatch(/^mcpServers\.token\.[0-9a-f]{16}$/);
      expect(secrets[0]?.[1]).toMatch(/^[0-9a-f]{64}$/);
      expect(secrets[0]?.[1]).not.toBe(gitToken());
      expect(gitToken()).toBe(deriveServerToken(secrets[0]?.[1] ?? '', 'git'));
    });

    it('is unavailable with the FTS5 reason on a local VS Code that lacks it (and does not stop git)', async () => {
      rag.state.probe = { ok: false, reason: 'no such module: fts5', needs: 'fts5' };
      (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings(ragSettings);
      activate(ctx as never);
      await untilServer('coderag', 'unavailable');
      expect(serverInfo('coderag')?.reason).toBe("Needs VS Code 1.103 or newer (this build's SQLite lacks FTS5)");
      expect(rag.activateCodeRagServer).not.toHaveBeenCalled();
      await until('running');
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('names the remote host requirement when the extension host is remote', async () => {
      rag.state.probe = { ok: false, reason: 'no such module: fts5', needs: 'fts5' };
      (vscode.env as { remoteName?: string }).remoteName = 'wsl';
      (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings(ragSettings);
      activate(ctx as never);
      await untilServer('coderag', 'unavailable');
      expect(serverInfo('coderag')?.reason).toBe("Needs Node.js 22.16 or newer on the remote host (this host's SQLite lacks FTS5)");
    });

    it('is unavailable without workspace storage (no folder)', async () => {
      ctx = makeContext(root, { storage: false });
      activate(ctx as never);
      expect(serverInfo('coderag')?.state).toBe('stopped');
      await handler('mcpServers.startServer')('coderag');
      expect(serverInfo('coderag')).toMatchObject({ state: 'unavailable', reason: 'Open a folder to use CodeRAG' });
    });

    it('reports a missing embedding URL as the start error with the real setting name', async () => {
      rag.activateCodeRagServer.mockRejectedValueOnce(new Error('mcpServers.coderag.embeddingUrl is required. Configure it in VS Code settings.'));
      (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings({ 'mcpServers.coderag.autoStart': true });
      activate(ctx as never);
      await untilServer('coderag', 'error');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('mcpServers.coderag.embeddingUrl is required'));
    });

    it('passes the API key from SecretStorage through the apiKey option, and never logs or shows it', async () => {
      ctx.secrets.values.set(CODERAG_API_KEY_SECRET, 'sk-from-secret-storage');
      (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings(ragSettings);
      activate(ctx as never);
      await untilServer('coderag', 'running');
      expect(ragOptions()['apiKey']).toBe('sk-from-secret-storage');
      expect(outputLines().join('\n')).not.toContain('sk-from-secret-storage');
      expect(JSON.stringify(vi.mocked(vscode.window.showInformationMessage).mock.calls)).not.toContain('sk-from-secret-storage');
    });

    describe('while running', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings(ragSettings);
      });

      it('restarts once, after 500 ms, when settings that matter change, and tells the user', async () => {
        activate(ctx as never);
        await untilServer('coderag', 'running');
        setting('mcpServers.coderag.topK', 9);
        test.fireConfigChange(['mcpServers.coderag.topK']);
        await vi.advanceTimersByTimeAsync(200);
        setting('mcpServers.coderag.chunkSize', 800);
        test.fireConfigChange(['mcpServers.coderag.chunkSize']);
        await vi.advanceTimersByTimeAsync(499);
        expect(rag.activateCodeRagServer).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => {
          expect(rag.activateCodeRagServer).toHaveBeenCalledTimes(2);
        });
        expect(rag.state.instances[0]?.close).toHaveBeenCalledOnce();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('CodeRAG server restarted on port 3100');
      });

      it('does not restart for autoStart changes or for settings that were rewritten unchanged', async () => {
        activate(ctx as never);
        await untilServer('coderag', 'running');
        setting('mcpServers.coderag.autoStart', false);
        test.fireConfigChange(['mcpServers.coderag.autoStart']);
        test.fireConfigChange(['mcpServers.coderag.topK']);
        await vi.advanceTimersByTimeAsync(600);
        expect(rag.activateCodeRagServer).toHaveBeenCalledOnce();
      });

      it('restarts with the new folder list and the new token when a folder is added', async () => {
        activate(ctx as never);
        await untilServer('coderag', 'running');
        test.setFolders(['/work/repo', '/work/other']);
        test.fireFolderChange();
        await vi.waitFor(() => {
          expect(rag.activateCodeRagServer).toHaveBeenCalledTimes(2);
        });
        expect(ragOptions(1)['workspaceFolders']).toEqual(['/work/repo', '/work/other']);
        expect(ragOptions(1)['authToken']).not.toBe(ragOptions(0)['authToken']);
      });

      it('setApiKey restarts the server with the new key exactly once (command and secret change event collapse)', async () => {
        activate(ctx as never);
        await untilServer('coderag', 'running');
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('sk-new-key');
        await handler('mcpServers.coderag.setApiKey')();
        await vi.advanceTimersByTimeAsync(500);
        await vi.waitFor(() => {
          expect(rag.activateCodeRagServer).toHaveBeenCalledTimes(2);
        });
        await vi.advanceTimersByTimeAsync(600);
        expect(rag.activateCodeRagServer).toHaveBeenCalledTimes(2);
        expect(ragOptions(1)['apiKey']).toBe('sk-new-key');
      });

      it('an API key changed in another window (secret change event) restarts the server too', async () => {
        activate(ctx as never);
        await untilServer('coderag', 'running');
        await ctx.secrets.store(CODERAG_API_KEY_SECRET, 'sk-from-other-window');
        await vi.advanceTimersByTimeAsync(500);
        await vi.waitFor(() => {
          expect(rag.activateCodeRagServer).toHaveBeenCalledTimes(2);
        });
        expect(ragOptions(1)['apiKey']).toBe('sk-from-other-window');
      });

      it('clearApiKey restarts the server without a key', async () => {
        ctx.secrets.values.set(CODERAG_API_KEY_SECRET, 'sk-old');
        activate(ctx as never);
        await untilServer('coderag', 'running');
        await handler('mcpServers.coderag.clearApiKey')();
        await vi.advanceTimersByTimeAsync(500);
        await vi.waitFor(() => {
          expect(rag.activateCodeRagServer).toHaveBeenCalledTimes(2);
        });
        expect(ragOptions(1)).not.toHaveProperty('apiKey');
      });

      it('an API key change does nothing to a CodeRAG server that is not running', async () => {
        setting('mcpServers.coderag.autoStart', false);
        activate(ctx as never);
        await ctx.secrets.store(CODERAG_API_KEY_SECRET, 'sk-x');
        await vi.advanceTimersByTimeAsync(600);
        expect(rag.activateCodeRagServer).not.toHaveBeenCalled();
      });

      it('deactivate() closes the CodeRAG server (and with it the database)', async () => {
        activate(ctx as never);
        await untilServer('coderag', 'running');
        await deactivate();
        expect(rag.state.instances[0]?.close).toHaveBeenCalledOnce();
        expect(serverInfo('coderag')?.state).toBe('stopped');
      });
    });
  });

  describe('token changed in another window', () => {
    const NEW_TOKEN = 'n'.repeat(64);
    const tokenKey = (): string => {
      const key = [...ctx.secrets.values.keys()].find((candidate) => candidate.startsWith('mcpServers.token.'));
      if (!key) throw new Error('no token secret stored yet');
      return key;
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('restarts the running servers with the new token after the usual debounce, and says so', async () => {
      activate(ctx as never);
      await until('running');
      const listener = vi.fn();
      test.mcpProviders().get('mcpServers.servers')?.onDidChangeMcpServerDefinitions?.(listener);
      const before = gitToken();
      await ctx.secrets.store(tokenKey(), NEW_TOKEN);
      await vi.advanceTimersByTimeAsync(499);
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => {
        expect(git.activateGitServer).toHaveBeenCalledTimes(2);
      });
      const after = (git.activateGitServer.mock.calls[1]?.[0] as unknown as { authToken: string }).authToken;
      expect(after).not.toBe(before);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringMatching(/token.*another window.*Git/i));
      expect(listener).toHaveBeenCalled();
      expect(outputLines().join('\n')).not.toContain(NEW_TOKEN);
    });

    it('several quick changes cause one restart', async () => {
      activate(ctx as never);
      await until('running');
      await ctx.secrets.store(tokenKey(), 'a'.repeat(64));
      await vi.advanceTimersByTimeAsync(200);
      await ctx.secrets.store(tokenKey(), 'b'.repeat(64));
      await vi.advanceTimersByTimeAsync(600);
      await vi.waitFor(() => {
        expect(git.activateGitServer).toHaveBeenCalledTimes(2);
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(git.activateGitServer).toHaveBeenCalledTimes(2);
    });

    it('rotating here restarts once (the command) and the change event does not restart a second time', async () => {
      activate(ctx as never);
      await until('running');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Rotate' as never);
      await handler('mcpServers.rotateToken')();
      await vi.advanceTimersByTimeAsync(1000);
      expect(git.activateGitServer).toHaveBeenCalledTimes(2);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(expect.stringMatching(/another window/i));
    });

    it('does nothing for the token of another workspace, for the API key or for servers that are not running', async () => {
      activate(ctx as never);
      await until('running');
      await ctx.secrets.store('mcpServers.token.0123456789abcdef', NEW_TOKEN);
      await ctx.secrets.store(CODERAG_API_KEY_SECRET, 'sk-x');
      await vi.advanceTimersByTimeAsync(1000);
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      expect(rag.activateCodeRagServer).not.toHaveBeenCalled();
    });
  });

  describe('VS Code MCP integration', () => {
    const provider = (): { provide(): vscode.McpHttpServerDefinition[]; resolve(d: vscode.McpHttpServerDefinition): Promise<vscode.McpHttpServerDefinition> } => {
      const registered = test.mcpProviders().get('mcpServers.servers') as vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> | undefined;
      if (!registered) throw new Error('provider not registered');
      return {
        provide: () => registered.provideMcpServerDefinitions({} as never) as vscode.McpHttpServerDefinition[],
        resolve: (definition) => registered.resolveMcpServerDefinition?.(definition, {} as never) as Promise<vscode.McpHttpServerDefinition>,
      };
    };

    it('registers the provider declared in package.json and lists git and CodeRAG', async () => {
      activate(ctx as never);
      await until('running');
      expect(provider().provide().map((d) => [d.label, d.uri.toString()])).toEqual([
        ['MCP Servers: Git', 'http://127.0.0.1:3000/mcp'],
        ['MCP Servers: CodeRAG', 'http://127.0.0.1:3100/mcp'],
      ]);
    });

    it('resolving CodeRAG starts it on demand and injects the token that server uses (not the git server\'s)', async () => {
      activate(ctx as never);
      await until('running');
      const coderag = provider().provide()[1] as vscode.McpHttpServerDefinition;
      const resolved = await provider().resolve(coderag);
      expect(serverInfo('coderag')?.state).toBe('running');
      expect(resolved.headers).toEqual({ Authorization: `Bearer ${String(ragOptions()['authToken'])}` });
      expect(ragOptions()['authToken']).not.toBe(gitToken());
    });

    it('omits CodeRAG once it is known to be unavailable, and resolving it throws the reason', async () => {
      rag.state.probe = { ok: false, reason: 'no such module: fts5', needs: 'fts5' };
      activate(ctx as never);
      await until('running');
      const coderag = provider().provide()[1] as vscode.McpHttpServerDefinition;
      await expect(provider().resolve(coderag)).rejects.toThrow("Needs VS Code 1.103 or newer (this build's SQLite lacks FTS5)");
      expect(provider().provide().map((d) => d.label)).toEqual(['MCP Servers: Git']);
    });

    it('does not register anything on hosts without the MCP API, and still activates', async () => {
      const lm = vscode.lm as { registerMcpServerDefinitionProvider?: unknown };
      const original = lm.registerMcpServerDefinitionProvider;
      lm.registerMcpServerDefinitionProvider = undefined;
      try {
        activate(ctx as never);
        await until('running');
        expect(test.mcpProviders().size).toBe(0);
      } finally {
        lm.registerMcpServerDefinitionProvider = original;
      }
    });

    it('tells VS Code when the definitions change', async () => {
      activate(ctx as never);
      const registered = test.mcpProviders().get('mcpServers.servers');
      const listener = vi.fn();
      registered?.onDidChangeMcpServerDefinitions?.(listener);
      setting('mcpServers.git.port', 4100);
      test.fireConfigChange(['mcpServers.git.port']);
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('headers helper', () => {
    it('keeps activating (and says why in the log) when the helper script cannot be copied', async () => {
      activate(ctx as never);
      await until('running');
      await vi.waitFor(() => {
        expect(outputLines().some((line) => /headers helper/i.test(line))).toBe(true);
      });
    });
  });

  describe('commands end to end', () => {
    it('copy server URL from the palette copies the URL of the running server', async () => {
      activate(ctx as never);
      await until('running');
      await handler('mcpServers.copyServerUrl')();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3000/mcp');
    });

    it('restart keeps the token of the session', async () => {
      activate(ctx as never);
      await until('running');
      await handler('mcpServers.restartServer')('git');
      const tokens = git.activateGitServer.mock.calls.map((c) => (c[0] as unknown as { authToken: string }).authToken);
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toBe(tokens[1]);
    });
  });
});
