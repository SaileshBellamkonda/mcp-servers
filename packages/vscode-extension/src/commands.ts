import * as vscode from 'vscode';
import type { ServerRegistry } from './server-registry';

export function registerCommands(context: vscode.ExtensionContext, registry: ServerRegistry) {
  const start = vscode.commands.registerCommand('mcpServers.startServer', async (id: string) => {
    try {
      await registry.start(id);
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const stop = vscode.commands.registerCommand('mcpServers.stopServer', async (id: string) => {
    try {
      await registry.stop(id);
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const restart = vscode.commands.registerCommand('mcpServers.restartServer', async (id: string) => {
    try {
      await registry.stop(id);
      await registry.start(id);
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const copyUrl = vscode.commands.registerCommand('mcpServers.copyServerUrl', async (id: string) => {
    const server = registry.servers.find(s => s.id === id);
    if (!server || !server.port) {
      vscode.window.showErrorMessage('Server is not running');
      return;
    }
    const url = `http://localhost:${server.port}`;
    await vscode.env.clipboard.writeText(url);
    vscode.window.showInformationMessage('Server URL copied to clipboard');
  });

  context.subscriptions.push(start, stop, restart, copyUrl);
  return [start, stop, restart, copyUrl];
}
