import * as vscode from 'vscode';
import type { IManagedServer, ServerStatus } from '../managed-server';

interface HttpServerLike {
  close(callback?: () => void): void;
}

/**
 * Adapter that wraps the server-git embedded entry point as an IManagedServer.
 * Uses dynamic import so the heavy ESM module is loaded only on first start().
 */
export class GitServerAdapter implements IManagedServer {
  readonly id = 'git';
  readonly displayName = 'Git MCP Server';

  private _status: ServerStatus = 'stopped';
  private _port: number | undefined;
  private _httpServer: HttpServerLike | undefined;

  private readonly _onDidChangeStatusEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus: vscode.Event<void> =
    this._onDidChangeStatusEmitter.event;

  constructor(private readonly _outputChannel: vscode.OutputChannel) {}

  get status(): ServerStatus {
    return this._status;
  }

  get port(): number | undefined {
    return this._port;
  }

  private setStatus(status: ServerStatus): void {
    this._status = status;
    this._onDidChangeStatusEmitter.fire();
  }

  async start(): Promise<void> {
    if (this._status === 'running') return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.setStatus('error');
      vscode.window.showErrorMessage(
        'Git MCP Server requires an open workspace.'
      );
      return;
    }

    const config = vscode.workspace.getConfiguration('mcpServers.git');
    const port: number = config.get('port', 3000);

    this.setStatus('starting');

    try {
      // Dynamic import keeps the ESM server-git module out of the CJS bundle
      // until the adapter actually starts for the first time.
      const { activateGitServer } = await import(
        '@mcp-servers/server-git/embedded'
      );
      const paths = folders.map(f => f.uri.fsPath);
      const instance = await activateGitServer(paths, port);

      this._httpServer = instance.httpServer;
      this._port = port;
      this.setStatus('running');
      this._outputChannel.appendLine(
        `Git MCP Server started on port ${port}`
      );
    } catch (err) {
      this.setStatus('error');
      this._outputChannel.appendLine(
        `Git MCP Server failed to start: ${String(err)}`
      );
      vscode.window.showErrorMessage(
        `Git MCP Server failed to start: port ${port} in use.`
      );
    }
  }

  async stop(): Promise<void> {
    if (this._status !== 'running') return;

    await new Promise<void>(resolve => {
      this._httpServer!.close(() => resolve());
    });

    this._httpServer = undefined;
    this._port = undefined;
    this.setStatus('stopped');
    this._outputChannel.appendLine('Git MCP Server stopped.');
  }

  dispose(): void {
    this._onDidChangeStatusEmitter.dispose();
  }
}
