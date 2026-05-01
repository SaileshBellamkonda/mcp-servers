import * as vscode from 'vscode';
import { ServerRegistry } from './server-registry';
import { GitServerAdapter } from './servers/git-server-adapter';
import { McpServersTreeProvider } from './tree-provider';
import { StatusBarController } from './status-bar';
import { registerCommands } from './commands';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('MCP Servers');
  context.subscriptions.push(output);

  const registry = new ServerRegistry();
  context.subscriptions.push(registry as unknown as vscode.Disposable);

  const gitAdapter = new GitServerAdapter(output);
  registry.register(gitAdapter);

  const treeProvider = new McpServersTreeProvider(registry);
  context.subscriptions.push(treeProvider as unknown as vscode.Disposable);
  vscode.window.createTreeView('mcpServers', { treeDataProvider: treeProvider });

  const statusBar = new StatusBarController(registry);
  context.subscriptions.push(statusBar);

  registerCommands(context, registry);

  const config = vscode.workspace.getConfiguration('mcpServers.git');
  const autoStart = config.get('autoStart', true) as boolean;
  if (autoStart) {
    // best-effort start; ignore errors here
    registry.start('git').catch(() => {});
  }
}

export function deactivate(): void {
  // noop; disposables will be cleaned by VS Code
}
