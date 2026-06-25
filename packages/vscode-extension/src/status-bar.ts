import * as vscode from 'vscode';
import type { ServerRegistry } from './server-registry';

export class StatusBarController implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(private readonly _registry: ServerRegistry) {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this._disposables.push(this._item);
    this._registry.onDidChange(() => { this.update(); });
    this.update();
    this._item.show();
  }

  private update(): void {
    const runningCount = this._registry.servers.filter(s => s.status === 'running').length;
    if (runningCount > 0) {
      this._item.text = `MCP: ${String(runningCount)} running`;
    } else {
      this._item.text = `MCP: idle`;
    }
  }

  dispose(): void {
    this._disposables.forEach(d => { d.dispose(); });
  }
}
