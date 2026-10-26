import * as vscode from 'vscode';
import { FailureReporter, registerCommands } from './commands';
import { EmbeddedServerAdapter, type AdapterDeps } from './core/embedded-server-adapter';
import { createLineLogger } from './core/logger';
import type { ServerDescriptor, ServerLogger } from './core/server-descriptor';
import { ServerRegistry } from './core/server-registry';
import { InMemoryTokenProvider, type TokenProvider } from './core/token-provider';
import { gitDescriptor } from './servers/git-descriptor';
import { loadServerModule } from './servers/module-loader';
import { StatusBarController } from './status-bar';
import { McpServersTreeProvider } from './tree-provider';

/** The servers this extension hosts. Adding a server means adding its descriptor here (and its module to the loader). */
const DESCRIPTORS: readonly ServerDescriptor[] = [gitDescriptor];

const CONTEXT_ANY_RUNNING = 'mcpServers.anyRunning';
const CONTEXT_ANY_STARTABLE = 'mcpServers.anyStartable';

interface Runtime {
  registry: ServerRegistry<EmbeddedServerAdapter>;
  logger: ServerLogger;
}
let runtime: Runtime | undefined;

/** The folders servers may use: those on the local (or remote-host) file system. */
function fileSystemFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);
}

function createDeps(logger: ServerLogger, tokens: TokenProvider): AdapterDeps {
  return {
    loadModule: loadServerModule,
    clock: () => Date.now(),
    logger,
    tokens,
    config: {
      get: <T>(section: string, key: string, fallback: T): T => vscode.workspace.getConfiguration(section).get<T>(key, fallback),
    },
    workspaceFolders: fileSystemFolders,
    scopeKey: () => (vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'no-workspace'),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('MCP Servers');
  context.subscriptions.push(output);
  const logger = createLineLogger((line) => {
    output.appendLine(line);
  });

  const deps = createDeps(logger, new InMemoryTokenProvider());
  const registry = new ServerRegistry<EmbeddedServerAdapter>();
  context.subscriptions.push(registry);
  for (const descriptor of DESCRIPTORS) registry.register(new EmbeddedServerAdapter(descriptor, deps));
  runtime = { registry, logger };

  const reporter = new FailureReporter();
  const autoStart = (server: EmbeddedServerAdapter): boolean =>
    deps.config.get(server.descriptor.settingsSection, 'autoStart', true);
  const start = (server: EmbeddedServerAdapter): void => {
    server.start().catch((error: unknown) => {
      reporter.report(server, 'start', error);
    });
  };

  const tree = new McpServersTreeProvider(registry);
  context.subscriptions.push(tree, vscode.window.createTreeView('mcpServers', { treeDataProvider: tree }));
  context.subscriptions.push(new StatusBarController(registry));
  context.subscriptions.push(...registerCommands(registry, reporter));

  const updateContextKeys = (): void => {
    const states = registry.servers.map((server) => server.getInfo().state);
    void vscode.commands.executeCommand('setContext', CONTEXT_ANY_RUNNING, states.includes('running'));
    void vscode.commands.executeCommand('setContext', CONTEXT_ANY_STARTABLE, states.some((state) => state === 'stopped' || state === 'error'));
  };
  context.subscriptions.push(registry.onDidChange(updateContextKeys));
  updateContextKeys();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      for (const server of registry.servers) {
        if (!event.affectsConfiguration(`${server.descriptor.settingsSection}.port`)) continue;
        server
          .applyConfiguration()
          .then((result) => {
            if (result === 'restarted') {
              const { port } = server.getInfo();
              void vscode.window.showInformationMessage(`${server.label} server restarted on port ${String(port)}`);
            } else if (server.getInfo().state === 'error' && autoStart(server)) {
              // A server that could not bind its port gets another try with the new one.
              start(server);
            }
          })
          .catch((error: unknown) => {
            reporter.report(server, 'restart', error);
          });
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      for (const server of registry.servers) {
        server
          .syncWorkspace()
          .then((result) => {
            if (result === 'became-available' && autoStart(server)) start(server);
          })
          .catch((error: unknown) => {
            reporter.report(server, 'update its workspace folders', error);
          });
      }
    })
  );

  for (const server of registry.servers) {
    if (server.getInfo().state === 'stopped' && autoStart(server)) start(server);
  }
}

/** Stops every server before the extension host goes away so no port stays bound. Never throws. */
export async function deactivate(): Promise<void> {
  const current = runtime;
  runtime = undefined;
  if (!current) return;
  try {
    await current.registry.stopAll();
  } catch (error) {
    current.logger.error(`failed to stop the servers: ${error instanceof AggregateError ? error.errors.map(String).join('; ') : String(error)}`);
  }
}
