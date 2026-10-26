import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Mock @mcp-servers/server-git/embedded — intercepted for both static and
// dynamic imports. GitServerAdapter uses dynamic import inside start().
// ---------------------------------------------------------------------------
vi.mock('@mcp-servers/server-git/embedded', () => ({
  activateGitServer: vi.fn(),
}));

// Import adapter AFTER vi.mock() hoisting
import { GitServerAdapter } from '../../src/servers/git-server-adapter';
import * as serverGitEmbedded from '@mcp-servers/server-git/embedded';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOutputChannel(): vscode.OutputChannel {
  return {
    appendLine: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.OutputChannel;
}

function makeInstance(port = 3000): {
  port: number;
  host: string;
  close: ReturnType<typeof vi.fn>;
  updateAllowedRepositories: ReturnType<typeof vi.fn>;
} {
  return {
    port,
    host: '127.0.0.1',
    close: vi.fn(() => Promise.resolve()),
    updateAllowedRepositories: vi.fn(),
  };
}

function setWorkspaceFolders(paths: string[]): void {
  (vscode.workspace as Record<string, unknown>).workspaceFolders = paths.map(
    (fsPath, index) => ({ uri: { fsPath }, name: `ws-${index}`, index })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GitServerAdapter', () => {
  let adapter: GitServerAdapter;
  let outputChannel: vscode.OutputChannel;
  const mockActivate = vi.mocked(serverGitEmbedded.activateGitServer);

  beforeEach(() => {
    outputChannel = makeOutputChannel();
    adapter = new GitServerAdapter(outputChannel);

    // Default: one workspace folder, port returns 3000
    setWorkspaceFolders(['/test/workspace']);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    } as unknown as vscode.WorkspaceConfiguration);

    // Default: activateGitServer resolves successfully
    mockActivate.mockResolvedValue(makeInstance() as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---- initial state -------------------------------------------------------
  it('initial status is "stopped"', () => {
    expect(adapter.status).toBe('stopped');
  });

  it('initial port is undefined', () => {
    expect(adapter.port).toBeUndefined();
  });

  it('id is "git"', () => {
    expect(adapter.id).toBe('git');
  });

  it('displayName is "Git MCP Server"', () => {
    expect(adapter.displayName).toBe('Git MCP Server');
  });

  // ---- start() — happy path -----------------------------------------------
  describe('start() — happy path', () => {
    it('transitions stopped → starting → running', async () => {
      let statusDuringActivation: string | undefined;
      mockActivate.mockImplementation(async () => {
        statusDuringActivation = adapter.status;
        return makeInstance() as never;
      });

      await adapter.start();

      expect(statusDuringActivation).toBe('starting');
      expect(adapter.status).toBe('running');
    });

    it('calls activateGitServer with the options API: folders, port, a random 32-byte hex token and a logger', async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((_key: string, defaultValue?: unknown) => {
          if (_key === 'port') return 4000;
          return defaultValue;
        }),
      } as unknown as vscode.WorkspaceConfiguration);

      await adapter.start();

      expect(mockActivate).toHaveBeenCalledTimes(1);
      expect(mockActivate).toHaveBeenCalledWith({
        workspaceFolders: ['/test/workspace'],
        port: 4000,
        authToken: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        logger: expect.objectContaining({ info: expect.any(Function), warning: expect.any(Function), error: expect.any(Function) }) as object,
      });
    });

    it('generates a fresh token for every start', async () => {
      await adapter.start();
      await adapter.stop();
      await adapter.start();
      const tokens = mockActivate.mock.calls.map((c) => c[0].authToken);
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).not.toBe(tokens[1]);
    });

    it('forwards server diagnostics to the output channel', async () => {
      await adapter.start();
      const options = mockActivate.mock.calls[0]?.[0];
      options?.logger?.warning('careful');
      expect(
        (outputChannel.appendLine as ReturnType<typeof vi.fn>).mock.calls.some(
          (args: string[][]) => typeof args[0] === 'string' && args[0].includes('careful')
        )
      ).toBe(true);
    });

    it('sets port to the configured value after successful start', async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((_key: string, defaultValue?: unknown) => {
          if (_key === 'port') return 4000;
          return defaultValue;
        }),
      } as unknown as vscode.WorkspaceConfiguration);

      mockActivate.mockResolvedValue(makeInstance(4000) as never);
      await adapter.start();

      expect(adapter.port).toBe(4000);
    });

    it('logs start event to output channel', async () => {
      await adapter.start();
      expect(
        (outputChannel.appendLine as ReturnType<typeof vi.fn>).mock.calls.some(
          (args: string[][]) => typeof args[0] === 'string' && args[0].includes('started')
        )
      ).toBe(true);
    });
  });

  // ---- start() — error cases ---------------------------------------------
  describe('start() — error cases', () => {
    it('sets status to "error" when no workspace folders', async () => {
      (vscode.workspace as Record<string, unknown>).workspaceFolders = undefined;
      await adapter.start();
      expect(adapter.status).toBe('error');
    });

    it('shows error notification when no workspace folders', async () => {
      (vscode.workspace as Record<string, unknown>).workspaceFolders = undefined;
      await adapter.start();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Git MCP Server requires an open workspace.'
      );
    });

    it('sets status to "error" when activateGitServer throws', async () => {
      mockActivate.mockRejectedValue(new Error('listen EADDRINUSE :::3000'));
      await adapter.start();
      expect(adapter.status).toBe('error');
    });

    it('logs error to output channel when activateGitServer throws', async () => {
      mockActivate.mockRejectedValue(new Error('listen EADDRINUSE :::3000'));
      await adapter.start();
      expect(outputChannel.appendLine).toHaveBeenCalled();
    });

    it('shows the real failure reason, not a generic "port in use", when activateGitServer throws', async () => {
      mockActivate.mockRejectedValue(new Error('listen EACCES: permission denied 127.0.0.1:80'));
      await adapter.start();
      const message = vi.mocked(vscode.window.showErrorMessage).mock.calls[0]?.[0];
      expect(message).toContain('EACCES');
      expect(message).not.toContain('in use');
    });

    it('is no-op when already running', async () => {
      await adapter.start();
      vi.clearAllMocks();
      await adapter.start(); // second call
      expect(mockActivate).not.toHaveBeenCalled();
    });
  });

  // ---- stop() -------------------------------------------------------------
  describe('stop()', () => {
    it('calls the instance close() and transitions to "stopped"', async () => {
      const instance = makeInstance();
      mockActivate.mockResolvedValue(instance as never);

      await adapter.start();
      expect(adapter.status).toBe('running');

      await adapter.stop();

      expect(instance.close).toHaveBeenCalledOnce();
      expect(adapter.status).toBe('stopped');
    });

    it('clears port after stop', async () => {
      await adapter.start();
      await adapter.stop();
      expect(adapter.port).toBeUndefined();
    });

    it('logs stop event to output channel', async () => {
      await adapter.start();
      vi.clearAllMocks();
      await adapter.stop();
      expect(
        (outputChannel.appendLine as ReturnType<typeof vi.fn>).mock.calls.some(
          (args: string[][]) => typeof args[0] === 'string' && args[0].includes('stopped')
        )
      ).toBe(true);
    });

    it('is no-op when already stopped', async () => {
      await expect(adapter.stop()).resolves.toBeUndefined();
      expect(adapter.status).toBe('stopped');
    });
  });

  // ---- onDidChangeStatus --------------------------------------------------
  describe('onDidChangeStatus', () => {
    it('fires when status changes to "starting"', async () => {
      const listener = vi.fn();
      adapter.onDidChangeStatus(listener);

      let calls = 0;
      mockActivate.mockImplementation(async () => {
        calls = listener.mock.calls.length; // captures calls during 'starting'
        return makeInstance() as never;
      });

      await adapter.start();
      expect(calls).toBeGreaterThanOrEqual(1); // fired at least once before running
    });

    it('fires when status changes to "running"', async () => {
      const listener = vi.fn();
      adapter.onDidChangeStatus(listener);
      await adapter.start();
      expect(listener).toHaveBeenCalled();
    });

    it('fires when status changes to "stopped"', async () => {
      await adapter.start();
      const listener = vi.fn();
      adapter.onDidChangeStatus(listener);
      await adapter.stop();
      expect(listener).toHaveBeenCalled();
    });
  });
});
