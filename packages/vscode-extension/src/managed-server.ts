import type * as vscode from 'vscode';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface IManagedServer {
  /** Unique key used to identify the server in the registry, e.g. 'git' */
  readonly id: string;
  /** Human-readable label shown in the TreeView, e.g. 'Git MCP Server' */
  readonly displayName: string;
  /** Current lifecycle state */
  readonly status: ServerStatus;
  /** HTTP port — defined only when status === 'running' */
  readonly port: number | undefined;
  /** Fires whenever this server's status property changes */
  readonly onDidChangeStatus: vscode.Event<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
