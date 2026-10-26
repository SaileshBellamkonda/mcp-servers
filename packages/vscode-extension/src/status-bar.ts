import * as vscode from 'vscode';
import type { EmbeddedServerAdapter } from './core/embedded-server-adapter';
import type { ServerInfo } from './core/server-descriptor';
import type { ServerRegistry } from './core/server-registry';

function line(info: ServerInfo): string {
  switch (info.state) {
    case 'running':
      return `${info.label}: running at ${String(info.url)}`;
    case 'error':
    case 'unavailable':
      return `${info.label}: ${info.state}${info.reason ? ` (${info.reason})` : ''}`;
    default:
      return `${info.label}: ${info.state}`;
  }
}

/** Status bar entry: how many servers run, with every server's state in the tooltip; click focuses the view. */
export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly registry: ServerRegistry<EmbeddedServerAdapter>) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'mcpServers.focus';
    this.subscription = registry.onDidChange(() => {
      this.update();
    });
    this.update();
    this.item.show();
  }

  private update(): void {
    const infos = this.registry.servers.map((server) => server.getInfo());
    const running = infos.filter((info) => info.state === 'running').length;
    const failed = infos.some((info) => info.state === 'error');
    const summary = running > 0 ? `${String(running)} running` : 'idle';
    this.item.text = `$(server) MCP: ${summary}${failed ? ' $(warning)' : ''}`;
    this.item.tooltip = infos.map(line).join('\n');
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}
