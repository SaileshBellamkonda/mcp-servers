import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { FailureReporter, registerCommands } from '../../src/commands';
import { makeRegistry } from './fake-servers';
import { callArg } from './call-args';

type Handler = (arg?: unknown) => Promise<void>;

async function setup(specs: Parameters<typeof makeRegistry>[0]) {
  const made = await makeRegistry(specs);
  const reporter = new FailureReporter();
  const disposables = registerCommands(made.registry, reporter);
  const handlers = new Map<string, Handler>();
  for (const [id, handler] of vi.mocked(vscode.commands.registerCommand).mock.calls) handlers.set(id, handler as Handler);
  return { ...made, handlers, disposables, run: (id: string, arg?: unknown) => handlers.get(id)?.(arg) };
}

const START = 'mcpServers.startServer';
const STOP = 'mcpServers.stopServer';
const RESTART = 'mcpServers.restartServer';
const COPY = 'mcpServers.copyServerUrl';

describe('commands', () => {
  beforeEach(() => {
    vi.mocked(vscode.commands.registerCommand).mockClear();
  });

  it('registers the four commands and returns their disposables', async () => {
    const { handlers, disposables } = await setup([['git', 'stopped']]);
    expect([...handlers.keys()].sort()).toEqual([COPY, RESTART, START, STOP]);
    expect(disposables).toHaveLength(4);
  });

  describe('with a tree element', () => {
    it('start starts that server', async () => {
      const { run, servers } = await setup([['git', 'stopped'], ['other', 'stopped']]);
      await run(START, servers['git']?.adapter);
      expect(servers['git']?.adapter.getInfo().state).toBe('running');
      expect(servers['other']?.adapter.getInfo().state).toBe('stopped');
    });

    it('stop stops and restart restarts that server', async () => {
      const { run, servers } = await setup([['git', 'running']]);
      await run(RESTART, servers['git']?.adapter);
      expect(servers['git']?.activate).toHaveBeenCalledTimes(2);
      await run(STOP, servers['git']?.adapter);
      expect(servers['git']?.adapter.getInfo().state).toBe('stopped');
    });
  });

  describe('with a server id', () => {
    it('acts on the server with that id', async () => {
      const { run, servers } = await setup([['git', 'stopped'], ['other', 'stopped']]);
      await run(START, 'other');
      expect(servers['other']?.adapter.getInfo().state).toBe('running');
      expect(servers['git']?.adapter.getInfo().state).toBe('stopped');
    });

    it('reports an unknown id once as an error', async () => {
      const { run } = await setup([['git', 'stopped']]);
      await run(START, 'nope');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Unknown MCP server: nope');
    });
  });

  describe('from the command palette (no argument)', () => {
    it('acts directly when exactly one server qualifies', async () => {
      const { run, servers } = await setup([['git', 'running'], ['other', 'stopped']]);
      await run(STOP);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(servers['git']?.adapter.getInfo().state).toBe('stopped');
    });

    it('start offers only stopped and errored servers', async () => {
      const { run, servers } = await setup([['a', 'running'], ['b', 'stopped'], ['c', 'error'], ['d', 'unavailable']]);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined as never);
      await run(START);
      const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0]?.[0] as { label: string; id: string }[];
      expect(items.map((i) => i.id)).toEqual(['b', 'c']);
      expect(servers['b']?.adapter.getInfo().state).toBe('stopped');
    });

    it('stop, restart and copy offer only running servers and start the picked one', async () => {
      const { run, servers } = await setup([['a', 'running'], ['b', 'running'], ['c', 'stopped']]);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({ id: 'b', label: 'B' } as never);
      await run(STOP);
      const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0]?.[0] as unknown as { id: string }[];
      expect(items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(servers['b']?.adapter.getInfo().state).toBe('stopped');
      expect(servers['a']?.adapter.getInfo().state).toBe('running');
    });

    it('does nothing when the pick is cancelled', async () => {
      const { run, servers } = await setup([['a', 'running'], ['b', 'running']]);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined as never);
      await run(RESTART);
      expect(servers['a']?.activate).toHaveBeenCalledOnce();
      expect(servers['b']?.activate).toHaveBeenCalledOnce();
    });

    it.each([[STOP], [RESTART], [COPY]])('%s with no running server says so', async (command) => {
      const { run } = await setup([['a', 'stopped']]);
      await run(command);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No MCP server is running.');
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('start with only unavailable servers explains why', async () => {
      const { run } = await setup([['a', 'unavailable']]);
      await run(START);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('A cannot run here');
    });

    it('start with every server running says so', async () => {
      const { run } = await setup([['a', 'running']]);
      await run(START);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('All MCP servers are already running.');
    });

    it('shows each candidate with its state and port', async () => {
      const { run } = await setup([['a', 'running', 3000], ['b', 'running', 3200]]);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined as never);
      await run(COPY);
      const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0]?.[0] as { label: string; description: string }[];
      expect(items).toMatchObject([
        { label: 'A', description: 'running on port 3000' },
        { label: 'B', description: 'running on port 3200' },
      ]);
    });
  });

  describe('error handling', () => {
    it('reports a failing start exactly once', async () => {
      const { run, servers } = await setup([['git', 'error']]);
      await run(START, servers['git']?.adapter);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('GIT server failed to start: GIT exploded');
    });

    it('reports a failing restart', async () => {
      const { run, servers } = await setup([['git', 'running']]);
      servers['git']?.activate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      await run(RESTART, servers['git']?.adapter);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        'GIT server failed to restart: Port 3000 is already in use (change mcpServers.git.port)'
      );
    });

    it('reports a failing stop', async () => {
      const { run, servers } = await setup([['git', 'running']]);
      servers['git']?.close.mockRejectedValueOnce(new Error('stuck'));
      await run(STOP, servers['git']?.adapter);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('GIT server: Failed to stop: stuck');
    });

    it('start on an unavailable server warns with the reason instead of failing', async () => {
      const { run, servers } = await setup([['git', 'unavailable']]);
      await run(START, servers['git']?.adapter);
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('GIT server is unavailable: GIT cannot run here');
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('copyServerUrl', () => {
    it('copies http://127.0.0.1:<port>/mcp for the element', async () => {
      const { run, servers } = await setup([['git', 'running', 4242]]);
      await run(COPY, servers['git']?.adapter);
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4242/mcp');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('copies the URL of the only running server from the palette', async () => {
      const { run } = await setup([['git', 'running', 4242], ['other', 'stopped']]);
      await run(COPY);
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4242/mcp');
    });

    it('never copies the token', async () => {
      const { run, servers } = await setup([['git', 'running']]);
      const { authToken } = callArg<{ authToken: string }>(servers['git']?.activate);
      await run(COPY, servers['git']?.adapter);
      const copied = vi.mocked(vscode.env.clipboard.writeText).mock.calls.map(String).join('\n');
      const shown = vi.mocked(vscode.window.showInformationMessage).mock.calls.map(String).join('\n');
      expect(copied + shown).not.toContain(authToken);
    });

    it('reports a server that is not running', async () => {
      const { run, servers } = await setup([['git', 'stopped']]);
      await run(COPY, servers['git']?.adapter);
      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('GIT server is not running');
    });
  });
});

describe('FailureReporter', () => {
  it('shows an error once per error object, however many callers report it', async () => {
    const { servers } = await makeRegistry([['git', 'stopped']]);
    const reporter = new FailureReporter();
    const error = new Error('Port 3000 is already in use');
    reporter.report(servers['git']!.adapter, 'start', error);
    reporter.report(servers['git']!.adapter, 'start', error);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('GIT server failed to start: Port 3000 is already in use');
  });

  it('reports non-Error values and distinct errors separately', async () => {
    const { servers } = await makeRegistry([['git', 'stopped']]);
    const reporter = new FailureReporter();
    reporter.report(servers['git']!.adapter, 'start', 'plain');
    reporter.report(servers['git']!.adapter, 'update its workspace folders', new Error('x'));
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls.map((c) => c[0])).toEqual([
      'GIT server failed to start: plain',
      'GIT server failed to update its workspace folders: x',
    ]);
  });
});
