import path from 'node:path';
import * as vscode from 'vscode';
import { FailureReporter, registerCommands } from './commands';
import { Debouncer } from './core/debouncer';
import { EmbeddedServerAdapter, type AdapterDeps } from './core/embedded-server-adapter';
import { installHeadersHelper } from './core/helper-installer';
import { createLineLogger } from './core/logger';
import type { ServerDescriptor, ServerLogger } from './core/server-descriptor';
import { ServerRegistry } from './core/server-registry';
import { computeScopeKey, SecretStorageTokenProvider, tokenSecretKey, type TokenProvider } from './core/token-provider';
import { CODERAG_API_KEY_SECRET, registerIntegrationCommands } from './integration-commands';
import { registerMcpProvider } from './mcp-provider';
import { createCodeRagDescriptor } from './servers/coderag-descriptor';
import { gitDescriptor } from './servers/git-descriptor';
import { loadServerModule } from './servers/module-loader';
import { StatusBarController } from './status-bar';
import { McpServersTreeProvider } from './tree-provider';

/** Settings are applied once they stop changing for this long, so editing several settings restarts a server once. */
const SETTINGS_DEBOUNCE_MS = 500;
/** Debouncer key of the token-changed restart (server ids are plain words, so this cannot collide). */
const TOKEN_CHANGE_KEY = 'secret:token';

/**
 * The servers this extension hosts. Adding a server means adding its descriptor here (and its module to the
 * loader); CodeRAG needs the extension's storage and secrets, so its descriptor is built from the context.
 */
function createDescriptors(context: vscode.ExtensionContext): readonly ServerDescriptor[] {
  return [
    gitDescriptor,
    createCodeRagDescriptor({
      // The bundle (dist/extension.js) sits next to dist/native, where the staged tree-sitter and sqlite-vec are.
      nativeModulesDir: path.join(__dirname, 'native'),
      storageDir: () => context.storageUri?.fsPath,
      readApiKey: () => Promise.resolve(context.secrets.get(CODERAG_API_KEY_SECRET)),
      isRemote: () => vscode.env.remoteName !== undefined,
    }),
  ];
}

const CONTEXT_ANY_RUNNING = 'mcpServers.anyRunning';
const CONTEXT_ANY_STARTABLE = 'mcpServers.anyStartable';

interface Runtime {
  registry: ServerRegistry<EmbeddedServerAdapter>;
  logger: ServerLogger;
  debouncer: Debouncer;
}
let runtime: Runtime | undefined;

function fileFolders(): readonly vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
}

/** The folders servers may use: those on the local (or remote-host) file system. */
function fileSystemFolders(): string[] {
  return fileFolders().map((folder) => folder.uri.fsPath);
}

/** Identifies the workspace (and with it the token): a hash of the sorted file-scheme folder URIs. */
function workspaceScopeKey(): string {
  return computeScopeKey(fileFolders().map((folder) => folder.uri.toString()));
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
    scopeKey: workspaceScopeKey,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('MCP Servers');
  context.subscriptions.push(output);
  const logger = createLineLogger((line) => {
    output.appendLine(line);
  });

  // One token per workspace, kept in SecretStorage and mirrored to <globalStorage>/tokens/<scope>.json (0600).
  const tokens = new SecretStorageTokenProvider(context.secrets, path.join(context.globalStorageUri.fsPath, 'tokens'), {
    onMirrorError: (error) => {
      logger.warning(`could not write the token file for the headers helper: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  const deps = createDeps(logger, tokens);
  const registry = new ServerRegistry<EmbeddedServerAdapter>();
  context.subscriptions.push(registry);
  for (const descriptor of createDescriptors(context)) registry.register(new EmbeddedServerAdapter(descriptor, deps));
  const debouncer = new Debouncer(SETTINGS_DEBOUNCE_MS);
  context.subscriptions.push({ dispose: () => { debouncer.dispose(); } });
  runtime = { registry, logger, debouncer };

  const reporter = new FailureReporter();
  const autoStart = (server: EmbeddedServerAdapter): boolean =>
    deps.config.get(server.descriptor.settingsSection, 'autoStart', server.descriptor.autoStartDefault ?? true);
  const start = (server: EmbeddedServerAdapter): void => {
    server.start().catch((error: unknown) => {
      reporter.report(server, 'start', error);
    });
  };

  const tree = new McpServersTreeProvider(registry);
  context.subscriptions.push(tree, vscode.window.createTreeView('mcpServers', { treeDataProvider: tree }));
  context.subscriptions.push(new StatusBarController(registry));
  context.subscriptions.push(...registerCommands(registry, reporter));

  // VS Code's own MCP support (agent mode, MCP servers view), where the host has the API (>= 1.101).
  const mcp = registerMcpProvider(registry, tokens, workspaceScopeKey);
  if (mcp) context.subscriptions.push(mcp);

  // A stable copy of the headers helper, so .mcp.json entries survive extension upgrades.
  const helperPath = path.join(context.globalStorageUri.fsPath, 'bin', 'mcp-headers.js');
  installHeadersHelper(path.join(__dirname, 'mcp-headers.js'), context.globalStorageUri.fsPath).catch((error: unknown) => {
    logger.warning(`could not install the headers helper (${error instanceof Error ? error.message : String(error)}); "Add to Claude Code" will not work until it is`);
  });

  /** Servers whose API key changed since their settings were last applied. */
  const apiKeyChanged = new Set<string>();
  const restartIfRunning = async (server: EmbeddedServerAdapter): Promise<void> => {
    if (server.getInfo().state !== 'running') return;
    await server.restart();
    void vscode.window.showInformationMessage(`${server.label} server restarted on port ${String(server.getInfo().port)}`);
  };
  const applySettings = (server: EmbeddedServerAdapter): void => {
    const keyChanged = apiKeyChanged.delete(server.id);
    (keyChanged
      ? restartIfRunning(server)
      : server.applyConfiguration().then((result) => {
          if (result === 'restarted') {
            void vscode.window.showInformationMessage(`${server.label} server restarted on port ${String(server.getInfo().port)}`);
          } else if (server.getInfo().state === 'error' && autoStart(server)) {
            // A server that could not start gets another try with the new settings.
            start(server);
          }
        })
    ).catch((error: unknown) => {
      reporter.report(server, 'restart', error);
    });
  };
  const onApiKeyChanged = (): void => {
    const coderag = registry.get('coderag');
    if (!coderag) return;
    apiKeyChanged.add(coderag.id);
    debouncer.trigger(coderag.id, () => { applySettings(coderag); });
  };
  /**
   * The workspace token was replaced (another window rotated it, or won a first-run race): servers that still run
   * with the old one restart. Our own rotate/first-run is a no-op here, the servers already have the stored value.
   */
  const applyTokenChange = async (): Promise<void> => {
    const restarted: string[] = [];
    await Promise.all(
      registry.servers.map(async (server) => {
        try {
          if ((await server.applyTokenChange()) === 'restarted') restarted.push(server.label);
        } catch (error) {
          reporter.report(server, 'restart', error);
        }
      })
    );
    if (restarted.length === 0) return;
    mcp?.provider.notifyChanged({ newToken: true });
    void vscode.window.showInformationMessage(`The MCP server token was changed in another window; ${restarted.join(', ')} restarted to use it.`);
  };
  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (event.key === CODERAG_API_KEY_SECRET) onApiKeyChanged();
      else if (event.key === tokenSecretKey(workspaceScopeKey())) {
        debouncer.trigger(TOKEN_CHANGE_KEY, () => {
          void applyTokenChange();
        });
      }
    }),
    ...registerIntegrationCommands({
      registry,
      reporter,
      secrets: context.secrets,
      tokens,
      scopeKey: workspaceScopeKey,
      helperPath,
      firstWorkspaceFolder: () => fileSystemFolders()[0],
      onApiKeyChanged,
      notifyDefinitionsChanged: (options) => { mcp?.provider.notifyChanged(options); },
    })
  );

  const updateContextKeys = (): void => {
    const states = registry.servers.map((server) => server.getInfo().state);
    void vscode.commands.executeCommand('setContext', CONTEXT_ANY_RUNNING, states.includes('running'));
    void vscode.commands.executeCommand('setContext', CONTEXT_ANY_STARTABLE, states.some((state) => state === 'stopped' || state === 'error'));
  };
  context.subscriptions.push(registry.onDidChange(updateContextKeys));
  updateContextKeys();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      let urlsMayHaveChanged = false;
      for (const server of registry.servers) {
        const { settingsSection, restartSettings = [] } = server.descriptor;
        if (!['port', ...restartSettings].some((key) => event.affectsConfiguration(`${settingsSection}.${key}`))) continue;
        urlsMayHaveChanged ||= event.affectsConfiguration(`${settingsSection}.port`);
        // Editing several settings (or a settings file saved in pieces) causes one restart, after they settle.
        debouncer.trigger(server.id, () => { applySettings(server); });
      }
      if (urlsMayHaveChanged) mcp?.provider.notifyChanged();
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
  current.debouncer.dispose();
  try {
    await current.registry.stopAll();
  } catch (error) {
    current.logger.error(`failed to stop the servers: ${error instanceof AggregateError ? error.errors.map(String).join('; ') : String(error)}`);
  }
}
