import * as vscode from 'vscode';
import type { EmbeddedServerAdapter } from './core/embedded-server-adapter';
import type { ServerInfo, ServerState } from './core/server-descriptor';
import type { ServerRegistry } from './core/server-registry';

interface StateStyle {
  icon: string;
  color?: string;
}

const STYLE: Record<ServerState, StateStyle> = {
  stopped: { icon: 'circle-outline' },
  starting: { icon: 'loading~spin' },
  running: { icon: 'circle-filled', color: 'testing.iconPassed' },
  error: { icon: 'error', color: 'testing.iconFailed' },
  unavailable: { icon: 'warning', color: 'list.warningForeground' },
};

function describeState(info: ServerInfo): string {
  switch (info.state) {
    case 'running':
      return `running on port ${String(info.port)}`;
    case 'starting':
      return 'starting...';
    case 'unavailable':
      return info.reason ?? info.state;
    default:
      return info.state;
  }
}

/** The "MCP Servers" view: one flat root per server; `contextValue` is `server.<state>` for the menus. */
export class McpServersTreeProvider implements vscode.TreeDataProvider<EmbeddedServerAdapter>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;
  readonly onDidChangeTreeData: vscode.Event<void> = this.changed.event;

  constructor(private readonly registry: ServerRegistry<EmbeddedServerAdapter>) {
    this.subscription = this.registry.onDidChange(() => {
      this.changed.fire();
    });
  }

  getChildren(element?: EmbeddedServerAdapter): EmbeddedServerAdapter[] {
    return element ? [] : [...this.registry.servers];
  }

  getTreeItem(element: EmbeddedServerAdapter): vscode.TreeItem {
    const info = element.getInfo();
    const item = new vscode.TreeItem(info.label, vscode.TreeItemCollapsibleState.None);
    const style = STYLE[info.state];
    item.id = info.id;
    item.description = describeState(info);
    item.iconPath = new vscode.ThemeIcon(style.icon, style.color ? new vscode.ThemeColor(style.color) : undefined);
    item.contextValue = `server.${info.state}`;
    item.tooltip = tooltipFor(info);
    return item;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}

function tooltipFor(info: ServerInfo): string {
  const lines = [`${info.label} MCP server`, `State: ${info.state}`];
  if (info.url) lines.push(`URL: ${info.url}`);
  if (info.reason) lines.push(`Reason: ${info.reason}`);
  return lines.join('\n');
}
