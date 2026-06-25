import * as vscode from 'vscode';
import type { IManagedServer } from './managed-server';

/**
 * Owns all IManagedServer instances. Provides start/stop delegation,
 * and a single onDidChange event that fires whenever any server status changes.
 */
export class ServerRegistry implements vscode.Disposable {
  private readonly _servers = new Map<string, IManagedServer>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  private readonly _subscriptions: vscode.Disposable[] = [];

  /** Fires whenever any registered server changes status. */
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  /** Read-only snapshot of all registered servers in insertion order. */
  get servers(): readonly IManagedServer[] {
    return Array.from(this._servers.values());
  }

  /**
   * Register an adapter. Subscribes to its onDidChangeStatus so that
   * this registry's onDidChange event propagates status transitions.
   */
  register(server: IManagedServer): void {
    this._servers.set(server.id, server);
    const sub = server.onDidChangeStatus(() => { this._onDidChange.fire(); });
    this._subscriptions.push(sub);
  }

  /** Start the server with the given id. Throws if id is not registered. */
  async start(id: string): Promise<void> {
    const server = this._servers.get(id);
    if (!server) throw new Error(`Server not found: ${id}`);
    await server.start();
  }

  /** Stop the server with the given id. Throws if id is not registered. */
  async stop(id: string): Promise<void> {
    const server = this._servers.get(id);
    if (!server) throw new Error(`Server not found: ${id}`);
    await server.stop();
  }

  /** Stop all servers that are currently running or starting. */
  async stopAll(): Promise<void> {
    const promises = Array.from(this._servers.values())
      .filter(s => s.status === 'running' || s.status === 'starting')
      .map(s => s.stop());
    await Promise.all(promises);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._subscriptions.forEach(s => { s.dispose(); });
  }
}
