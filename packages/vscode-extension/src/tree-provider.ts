import * as vscode from 'vscode';
import type { ServerRegistry } from './server-registry';
import type { IManagedServer } from './managed-server';

export class McpServersTreeProvider implements vscode.TreeDataProvider<IManagedServer> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChange.event;

  constructor(private readonly _registry: ServerRegistry) {
    // Propagate registry change events to the tree view
    this._registry.onDidChange(() => { this._onDidChange.fire(); });
  }

  getChildren(element?: IManagedServer): vscode.ProviderResult<IManagedServer[]> {
    // This tree is flat — servers are root nodes and have no children.
    if (element) return [];
    return Array.from(this._registry.servers);
  }

  getTreeItem(element: IManagedServer): vscode.TreeItem {
    const status = element.status;
    const iconMap: Record<string, string> = {
      stopped: 'circle-outline',
      starting: 'loading~spin',
      running: 'circle-filled',
      error: 'error',
    };

    const labelParts: string[] = [element.displayName, status];
    if (status === 'running' && element.port !== undefined) {
      labelParts.push(String(element.port));
    }

    const item = new vscode.TreeItem(labelParts.join(' — '), vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(iconMap[status] ?? 'circle-outline');
    item.contextValue = status;
    return item;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
