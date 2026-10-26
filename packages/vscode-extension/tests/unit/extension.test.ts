import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

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
vi.mock('../../src/servers/module-loader', () => ({
  loadServerModule: vi.fn(() => Promise.resolve({ activateGitServer: git.activateGitServer })),
}));

import { activate, deactivate } from '../../src/extension';

type Item = vscode.TreeItem;
type Disposable = { dispose: () => void };

interface Provider {
  getChildren(): { getInfo(): { state: string; port?: number } }[];
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
function context(): { subscriptions: Disposable[] } {
  return { subscriptions: [] };
}
function setting(key: string, value: unknown): void {
  (vscode as unknown as { __test: { setSettings(v: Record<string, unknown>): void } }).__test.setSettings({ [key]: value });
}
const test = (vscode as unknown as { __test: { setFolders(p: string[]): void; fireConfigChange(k: string[]): void; fireFolderChange(): void; listenerCounts(): { config: number; folders: number }; reset(): void } }).__test;
function handler(id: string): (arg?: unknown) => Promise<void> {
  const call = vi.mocked(vscode.commands.registerCommand).mock.calls.find(([name]) => name === id);
  return call?.[1] as (arg?: unknown) => Promise<void>;
}
function outputLines(): string[] {
  const channel = vi.mocked(vscode.window.createOutputChannel).mock.results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };
  return channel.appendLine.mock.calls.map((c) => String(c[0]));
}
function contextKey(key: string): unknown {
  const calls = vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'setContext' && c[1] === key);
  return calls[calls.length - 1]?.[2];
}

describe('extension', () => {
  let ctx: ReturnType<typeof context>;

  beforeEach(() => {
    test.reset();
    git.state.instances.length = 0;
    git.state.nextPort = 3000;
    test.setFolders(['/work/repo']);
    ctx = context();
  });

  afterEach(async () => {
    await deactivate();
    ctx.subscriptions.forEach((d) => {
      d.dispose();
    });
  });

  describe('activation', () => {
    it('registers every disposable in context.subscriptions', () => {
      activate(ctx as never);
      const channel = vi.mocked(vscode.window.createOutputChannel).mock.results[0]?.value as Disposable & { dispose: ReturnType<typeof vi.fn> };
      const treeView = vi.mocked(vscode.window.createTreeView).mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
      const statusItem = vi.mocked(vscode.window.createStatusBarItem).mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
      const commandDisposables = vi.mocked(vscode.commands.registerCommand).mock.results.map((r) => r.value as { dispose: ReturnType<typeof vi.fn> });
      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('MCP Servers');
      expect(commandDisposables).toHaveLength(4);
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

    it('creates the "mcpServers" tree view with the git server in it', () => {
      activate(ctx as never);
      expect(vi.mocked(vscode.window.createTreeView).mock.calls[0]?.[0]).toBe('mcpServers');
      expect(treeProvider().getChildren()).toHaveLength(1);
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
      activate(ctx as never);
      await until('running');
      expect(contextKey('mcpServers.anyRunning')).toBe(true);
      expect(contextKey('mcpServers.anyStartable')).toBe(false);
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
    it('restarts a running server when its port changed and tells the user', async () => {
      activate(ctx as never);
      await until('running');
      setting('mcpServers.git.port', 4100);
      test.fireConfigChange(['mcpServers.git.port']);
      await vi.waitFor(() => {
        expect(treeProvider().getChildren()[0]?.getInfo().port).toBe(4100);
      });
      expect(git.state.instances[0]?.close).toHaveBeenCalledOnce();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Git server restarted on port 4100');
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
      await new Promise((resolve) => setImmediate(resolve));
      expect(git.activateGitServer).toHaveBeenCalledOnce();
    });

    it('reports a failing restart once', async () => {
      activate(ctx as never);
      await until('running');
      git.activateGitServer.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      setting('mcpServers.git.port', 4100);
      test.fireConfigChange(['mcpServers.git.port']);
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
      await until('running');
      expect(treeProvider().getChildren()[0]?.getInfo().port).toBe(4200);
    });
  });

  describe('workspace folder changes', () => {
    it('re-scopes the running git server without restarting it', async () => {
      activate(ctx as never);
      await until('running');
      test.setFolders(['/work/repo', '/work/other']);
      test.fireFolderChange();
      await vi.waitFor(() => {
        expect(git.state.instances[0]?.updateAllowedRepositories).toHaveBeenCalledWith(['/work/repo', '/work/other']);
      });
      expect(git.activateGitServer).toHaveBeenCalledOnce();
      expect(gitState()).toBe('running');
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
      test.setFolders(['/work/other']);
      test.fireFolderChange();
      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Git server failed to update its workspace folders: rescope failed');
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
