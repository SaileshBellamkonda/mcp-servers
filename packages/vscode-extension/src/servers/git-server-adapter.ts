import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { IManagedServer, ServerStatus } from '../managed-server';

/** The part of the embedded server's instance this adapter uses. */
interface RunningServer {
  port: number;
  close(): Promise<void>;
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
  private _instance: RunningServer | undefined;

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
      // A fresh token per start for now; a stable per-workspace token replaces this later.
      const authToken = randomBytes(32).toString('hex');
      const log = (level: string) => (data: unknown): void => {
        this._outputChannel.appendLine(`[${level}] ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      };
      const instance = await activateGitServer({
        workspaceFolders: folders.map(f => f.uri.fsPath),
        port,
        authToken,
        logger: { info: log('info'), warning: log('warning'), error: log('error') },
      });

      this._instance = instance;
      this._port = instance.port;
      this.setStatus('running');
      this._outputChannel.appendLine(
        `Git MCP Server started on port ${String(instance.port)}`
      );
    } catch (err: unknown) {
      this.setStatus('error');
      this._outputChannel.appendLine(
        `Git MCP Server failed to start: ${String(err)}`
      );
      vscode.window.showErrorMessage(
        `Git MCP Server failed to start: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async stop(): Promise<void> {
    if (this._status !== 'running') return;

    const instance = this._instance;
    this._instance = undefined;
    await instance?.close();

    this._port = undefined;
    this.setStatus('stopped');
    this._outputChannel.appendLine('Git MCP Server stopped.');
  }

  dispose(): void {
    this._onDidChangeStatusEmitter.dispose();
  }
}
