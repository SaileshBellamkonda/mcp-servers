import * as vscode from 'vscode';
import { ServerRegistry } from './server-registry';
import { GitServerAdapter } from './servers/git-server-adapter';
import { McpServersTreeProvider } from './tree-provider';
import { StatusBarController } from './status-bar';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('MCP Servers');
  context.subscriptions.push(output);

  const registry = new ServerRegistry();
  context.subscriptions.push(registry);

  const gitAdapter = new GitServerAdapter(output);
  registry.register(gitAdapter);

  const treeProvider = new McpServersTreeProvider(registry);
  context.subscriptions.push(treeProvider);
  vscode.window.createTreeView('mcpServers', { treeDataProvider: treeProvider });

  const statusBar = new StatusBarController(registry);
  context.subscriptions.push(statusBar);

  registerCommands(context, registry);

  const config = vscode.workspace.getConfiguration('mcpServers.git');
  const autoStart = config.get('autoStart', true) as boolean;
  if (autoStart) {
    // best-effort start; ignore errors here
    registry.start('git').catch(() => { /* intentional no-op */ });
  }
}

export function deactivate(): void {
  // intentional no-op; disposables will be cleaned by VS Code
}
