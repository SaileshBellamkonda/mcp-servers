import * as vscode from 'vscode';
import type { EmbeddedServerAdapter } from './core/embedded-server-adapter';
import type { ServerState } from './core/server-descriptor';
import type { ServerRegistry } from './core/server-registry';

export const COMMAND_START = 'mcpServers.startServer';
export const COMMAND_STOP = 'mcpServers.stopServer';
export const COMMAND_RESTART = 'mcpServers.restartServer';
export const COMMAND_COPY_URL = 'mcpServers.copyServerUrl';

type Action = 'start' | 'stop' | 'restart' | 'copy';

/** Which servers an action applies to when the command palette (no argument) has to choose. */
const CANDIDATE_STATES: Record<Action, readonly ServerState[]> = {
  start: ['stopped', 'error'],
  stop: ['running'],
  restart: ['running'],
  copy: ['running'],
};

const PICK_PLACEHOLDER: Record<Action, string> = {
  start: 'Select the MCP server to start',
  stop: 'Select the MCP server to stop',
  restart: 'Select the MCP server to restart',
  copy: 'Select the MCP server whose URL to copy',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shows a failure to the user once. The same error object (concurrent callers share one start promise) is never
 * shown twice.
 */
export class FailureReporter {
  private readonly reported = new WeakSet<object>();

  report(server: EmbeddedServerAdapter, verb: string, error: unknown): void {
    if (typeof error === 'object' && error !== null) {
      if (this.reported.has(error)) return;
      this.reported.add(error);
    }
    const reason = errorMessage(error);
    const text = verb === 'stop' ? `${server.label} server: ${reason}` : `${server.label} server failed to ${verb}: ${reason}`;
    void vscode.window.showErrorMessage(text);
  }
}

/** A tree element (anything with a string `id`) or a plain server id. */
function idFromArgument(argument: unknown): string | undefined {
  if (typeof argument === 'string') return argument;
  if (typeof argument === 'object' && argument !== null) {
    const id = (argument as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

async function chooseServer(
  registry: ServerRegistry<EmbeddedServerAdapter>,
  action: Action,
  argument: unknown
): Promise<EmbeddedServerAdapter | undefined> {
  const id = idFromArgument(argument);
  if (id !== undefined) {
    const server = registry.get(id);
    if (!server) void vscode.window.showErrorMessage(`Unknown MCP server: ${id}`);
    return server;
  }

  const candidates = registry.servers.filter((server) => CANDIDATE_STATES[action].includes(server.getInfo().state));
  if (candidates.length === 0) {
    const unavailable = registry.servers.map((server) => server.getInfo()).filter((info) => info.state === 'unavailable');
    if (action === 'start') {
      void vscode.window.showInformationMessage(
        unavailable.length > 0
          ? unavailable.map((info) => info.reason ?? `${info.label} is unavailable`).join(' ')
          : 'All MCP servers are already running.'
      );
    } else {
      void vscode.window.showInformationMessage('No MCP server is running.');
    }
    return undefined;
  }
  if (candidates.length === 1) return candidates[0];

  const picked = await vscode.window.showQuickPick(
    candidates.map((server) => {
      const info = server.getInfo();
      return {
        label: info.label,
        description: info.state === 'running' ? `running on port ${String(info.port)}` : info.state,
        id: info.id,
      };
    }),
    { placeHolder: PICK_PLACEHOLDER[action] }
  );
  return picked ? registry.get(picked.id) : undefined;
}

/** Registers the four commands; the returned disposables belong in `context.subscriptions`. */
export function registerCommands(registry: ServerRegistry<EmbeddedServerAdapter>, reporter: FailureReporter): vscode.Disposable[] {
  const register = (
    command: string,
    action: Action,
    run: (server: EmbeddedServerAdapter) => Promise<void>
  ): vscode.Disposable =>
    vscode.commands.registerCommand(command, async (argument?: unknown) => {
      const server = await chooseServer(registry, action, argument);
      if (server) await run(server);
    });

  return [
    register(COMMAND_START, 'start', async (server) => {
      try {
        await server.start();
        const info = server.getInfo();
        if (info.state === 'unavailable') {
          void vscode.window.showWarningMessage(`${server.label} server is unavailable: ${info.reason ?? 'unknown reason'}`);
        }
      } catch (error) {
        reporter.report(server, 'start', error);
      }
    }),
    register(COMMAND_STOP, 'stop', async (server) => {
      try {
        await server.stop();
      } catch (error) {
        reporter.report(server, 'stop', error);
      }
    }),
    register(COMMAND_RESTART, 'restart', async (server) => {
      try {
        await server.restart();
      } catch (error) {
        reporter.report(server, 'restart', error);
      }
    }),
    register(COMMAND_COPY_URL, 'copy', async (server) => {
      const { url } = server.getInfo();
      if (!url) {
        void vscode.window.showErrorMessage(`${server.label} server is not running`);
        return;
      }
      // Only ever the URL: the bearer token is never put on the clipboard.
      await vscode.env.clipboard.writeText(url);
      void vscode.window.showInformationMessage(`${server.label} server URL copied: ${url}`);
    }),
  ];
}
