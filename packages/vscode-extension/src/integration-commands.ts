import { existsSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import type { FailureReporter } from './commands';
import {
  buildAddJsonCommands,
  buildClientConfig,
  buildHeadersHelperCommand,
  buildServerEntry,
  clientServerName,
  mergeMcpJson,
  type ClientServerEntry,
  type ShellPlatform,
} from './core/client-config';
import type { EmbeddedServerAdapter } from './core/embedded-server-adapter';
import type { ServerRegistry } from './core/server-registry';
import type { SecretStorageTokenProvider, SecretStore } from './core/token-provider';

export const COMMAND_SET_API_KEY = 'mcpServers.coderag.setApiKey';
export const COMMAND_CLEAR_API_KEY = 'mcpServers.coderag.clearApiKey';
export const COMMAND_ROTATE_TOKEN = 'mcpServers.rotateToken';
export const COMMAND_ADD_TO_CLAUDE_CODE = 'mcpServers.addToClaudeCode';

/** The SecretStorage key of the CodeRAG embedding API key. There is deliberately no setting for it. */
export const CODERAG_API_KEY_SECRET = 'mcpServers.coderag.embeddingApiKey';

const WRITE = 'Write .mcp.json';
const WRITE_AND_EXCLUDE = 'Write and exclude from git';
const ROTATE = 'Rotate';

export interface IntegrationDeps {
  registry: ServerRegistry<EmbeddedServerAdapter>;
  reporter: FailureReporter;
  secrets: SecretStore;
  tokens: SecretStorageTokenProvider;
  scopeKey: () => string;
  /** The stable copy of the headers helper script (`<globalStorage>/bin/mcp-headers.js`). */
  helperPath: string;
  /** The first file-system workspace folder, where `.mcp.json` goes. */
  firstWorkspaceFolder: () => string | undefined;
  /** The CodeRAG API key was stored or cleared: restart a running CodeRAG server (debounced by the caller). */
  onApiKeyChanged: () => void;
  /** Tells VS Code's MCP support to ask for the definitions again. */
  notifyDefinitionsChanged: (options?: { newToken?: boolean }) => void;
  platform?: ShellPlatform;
}

interface ServerChoice extends vscode.QuickPickItem {
  id: string;
}
type Action = 'write' | 'command' | 'config';
interface ActionChoice extends vscode.QuickPickItem {
  action: Action;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The commands that touch secrets and client configuration. The returned disposables belong in `context.subscriptions`. */
export function registerIntegrationCommands(deps: IntegrationDeps): vscode.Disposable[] {
  const platform = deps.platform ?? process.platform;

  // ----------------------------------------------------------------------------------------------- API key
  const setApiKey = async (): Promise<void> => {
    const value = await vscode.window.showInputBox({
      title: 'CodeRAG embedding API key',
      prompt: 'API key for the embeddings endpoint. It is stored in VS Code Secret Storage, never in settings.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (text) => (text.trim() === '' ? 'Enter the API key' : undefined),
    });
    const key = value?.trim();
    if (key === undefined || key === '') return;
    await deps.secrets.store(CODERAG_API_KEY_SECRET, key);
    deps.onApiKeyChanged();
    void vscode.window.showInformationMessage('CodeRAG API key saved. A running CodeRAG server restarts to use it.');
  };

  const clearApiKey = async (): Promise<void> => {
    await deps.secrets.delete(CODERAG_API_KEY_SECRET);
    deps.onApiKeyChanged();
    void vscode.window.showInformationMessage('CodeRAG API key removed. A running CodeRAG server restarts without it.');
  };

  // ------------------------------------------------------------------------------------------ token rotation
  const rotateToken = async (): Promise<void> => {
    const choice = await vscode.window.showWarningMessage(
      'Rotate the MCP server token?',
      {
        modal: true,
        detail:
          'All servers of this workspace get a new bearer token and running servers restart. Client configurations that contain a static token stop working until you update them. ' +
          'Clients that use the headers helper (written by "Add to Claude Code") and VS Code itself pick up the new token automatically.',
      },
      ROTATE
    );
    if (choice !== ROTATE) return;
    await deps.tokens.rotate(deps.scopeKey());
    const running = deps.registry.servers.filter((server) => ['running', 'starting'].includes(server.getInfo().state));
    await Promise.all(
      running.map((server) =>
        server.restart().catch((error: unknown) => {
          deps.reporter.report(server, 'restart', error);
        })
      )
    );
    deps.notifyDefinitionsChanged({ newToken: true });
    void vscode.window.showInformationMessage(
      `MCP server token rotated${running.length > 0 ? ` and ${running.map((server) => server.label).join(', ')} restarted` : ''}.`
    );
  };

  // ----------------------------------------------------------------------------------------- Claude Code
  /** The servers a client configuration can point at: available ones with a fixed port. */
  const offerable = (): { servers: { server: EmbeddedServerAdapter; url: string }[]; notes: string[] } => {
    const servers: { server: EmbeddedServerAdapter; url: string }[] = [];
    const notes: string[] = [];
    for (const server of deps.registry.servers) {
      const info = server.getInfo();
      if (info.state === 'unavailable') {
        notes.push(info.reason ?? `${server.label} is unavailable`);
        continue;
      }
      const port = server.plannedPort();
      if (port === undefined || port === 0) {
        notes.push(`${server.label} needs a fixed port (the setting is 0 or invalid, so its URL would change on every start)`);
        continue;
      }
      servers.push({ server, url: `http://127.0.0.1:${String(port)}/mcp` });
    }
    return { servers, notes };
  };

  const isGitRepository = (folder: string): boolean => {
    try {
      return statSync(path.join(folder, '.git')).isDirectory();
    } catch {
      return false;
    }
  };

  const excludeFromGit = async (folder: string): Promise<void> => {
    const file = path.join(folder, '.git', 'info', 'exclude');
    let current = '';
    try {
      current = await readFile(file, 'utf8');
    } catch {
      await mkdir(path.dirname(file), { recursive: true });
    }
    if (current.split(/\r?\n/).some((line) => line.trim() === '.mcp.json' || line.trim() === '/.mcp.json')) return;
    await appendFile(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}.mcp.json\n`);
  };

  const writeMcpJson = async (entries: Record<string, ClientServerEntry>): Promise<void> => {
    const folder = deps.firstWorkspaceFolder();
    if (folder === undefined) {
      void vscode.window.showErrorMessage('Open a folder first: .mcp.json is written to the first workspace folder.');
      return;
    }
    const file = path.join(folder, '.mcp.json');
    let existing: string | undefined;
    try {
      existing = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') {
        void vscode.window.showErrorMessage(`Cannot read ${file}: ${errorMessage(error)}`);
        return;
      }
    }
    const merged = mergeMcpJson(existing, entries);
    if (!merged.ok) {
      void vscode.window.showErrorMessage(merged.error);
      return;
    }
    const offerExclude = isGitRepository(folder);
    const names = Object.keys(entries).join(', ');
    const choice = await vscode.window.showWarningMessage(
      `Write ${names} to ${file}?`,
      {
        modal: true,
        detail:
          'The entries contain a machine-specific path (the headers helper in VS Code\'s storage) and the server ports, but never a token. ' +
          'Think twice before committing this file to a shared repository.' +
          (merged.replaced.length > 0 ? ` Existing entries ${merged.replaced.join(', ')} are replaced.` : ''),
      },
      WRITE,
      ...(offerExclude ? [WRITE_AND_EXCLUDE] : [])
    );
    if (choice !== WRITE && choice !== WRITE_AND_EXCLUDE) return;
    try {
      await writeFile(file, merged.text, 'utf8');
      if (choice === WRITE_AND_EXCLUDE) await excludeFromGit(folder);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not write ${file}: ${errorMessage(error)}`);
      return;
    }
    void vscode.window.showInformationMessage(
      `Wrote ${names} to ${file}${choice === WRITE_AND_EXCLUDE ? ' and excluded it from git' : ''}. Start Claude Code in this folder (or run /mcp) to use it.`
    );
  };

  const addToClaudeCode = async (): Promise<void> => {
    const { servers, notes } = offerable();
    if (servers.length === 0) {
      void vscode.window.showInformationMessage(`No MCP server can be added right now. ${notes.join(' ')}`.trim());
      return;
    }
    if (notes.length > 0) void vscode.window.showInformationMessage(notes.join(' '));

    const picked = await vscode.window.showQuickPick<ServerChoice>(
      servers.map(({ server, url }) => ({ label: server.label, description: url, picked: true, id: server.id })),
      { canPickMany: true, placeHolder: 'Select the servers to add to Claude Code', title: 'Add MCP servers to Claude Code' }
    );
    if (!picked || picked.length === 0) return;
    const action = await vscode.window.showQuickPick<ActionChoice>(
      [
        { label: '$(file) Write .mcp.json in the first workspace folder', description: 'merged into an existing file', action: 'write' },
        { label: '$(terminal) Copy "claude mcp add-json" command(s)', description: 'local scope', action: 'command' },
        { label: '$(copy) Copy client config (JSON)', description: 'for any MCP client with headersHelper support', action: 'config' },
      ],
      { placeHolder: 'What should be done with the selection?' }
    );
    if (!action) return;

    if (!existsSync(deps.helperPath)) {
      void vscode.window.showErrorMessage(
        'The headers helper script is not installed (it is copied to VS Code\'s global storage when the extension starts). Reload the window and try again.'
      );
      return;
    }
    const entries: Record<string, ClientServerEntry> = {};
    for (const choice of picked) {
      const offer = servers.find(({ server }) => server.id === choice.id);
      if (!offer) continue;
      // Each entry names its server: the helper prints that server's own token, never the workspace token.
      const helper = buildHeadersHelperCommand({
        platform,
        helperPath: deps.helperPath,
        scopeKey: deps.scopeKey(),
        serverId: offer.server.id,
        tokensDir: deps.tokens.tokensDir,
      });
      entries[clientServerName(offer.server.id)] = buildServerEntry(offer.url, helper);
    }

    if (action.action === 'write') {
      await writeMcpJson(entries);
    } else if (action.action === 'command') {
      await vscode.env.clipboard.writeText(buildAddJsonCommands(platform, entries));
      void vscode.window.showInformationMessage('Copied the "claude mcp add-json" command(s). They contain no token; run them in your project folder.');
    } else {
      await vscode.env.clipboard.writeText(buildClientConfig(entries));
      void vscode.window.showInformationMessage('Copied the client configuration. It contains no token: the headersHelper command fetches it when the client connects.');
    }
  };

  const guarded =
    (run: () => Promise<void>) =>
    async (): Promise<void> => {
      try {
        await run();
      } catch (error) {
        void vscode.window.showErrorMessage(errorMessage(error));
      }
    };

  return [
    vscode.commands.registerCommand(COMMAND_SET_API_KEY, guarded(setApiKey)),
    vscode.commands.registerCommand(COMMAND_CLEAR_API_KEY, guarded(clearApiKey)),
    vscode.commands.registerCommand(COMMAND_ROTATE_TOKEN, guarded(rotateToken)),
    vscode.commands.registerCommand(COMMAND_ADD_TO_CLAUDE_CODE, guarded(addToClaudeCode)),
  ];
}
