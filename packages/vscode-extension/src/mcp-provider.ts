import * as vscode from 'vscode';
import type { EmbeddedServerAdapter } from './core/embedded-server-adapter';
import { Emitter } from './core/emitter';
import type { ServerRegistry } from './core/server-registry';
import type { TokenProvider } from './core/token-provider';

/** Must match `contributes.mcpServerDefinitionProviders[].id` in package.json. */
export const MCP_PROVIDER_ID = 'mcpServers.servers';

const LABEL_PREFIX = 'MCP Servers: ';

function labelOf(server: EmbeddedServerAdapter): string {
  return `${LABEL_PREFIX}${server.label}`;
}

/**
 * Offers the extension's servers to VS Code's own MCP support (agent mode, the MCP servers view). Every server
 * that can run here is listed, running or not, so the user can switch it on there; `resolveMcpServerDefinition`
 * starts it on demand and is the only place the bearer token is handed to VS Code (as a request header, never
 * in the URL and never in the listed definitions).
 */
export class McpServersDefinitionProvider implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>, vscode.Disposable {
  private readonly changed = new Emitter<void>();
  readonly onDidChangeMcpServerDefinitions: vscode.Event<void> = this.changed.event;
  private readonly subscription: vscode.Disposable;
  /** Bumped when the token is rotated: a new `version` makes VS Code re-resolve (and so re-read the token). */
  private generation = 0;
  private lastSignature: string;

  constructor(
    private readonly registry: ServerRegistry<EmbeddedServerAdapter>,
    private readonly tokens: TokenProvider,
    private readonly scopeKey: () => string
  ) {
    this.lastSignature = this.signature();
    this.subscription = registry.onDidChange(() => {
      const signature = this.signature();
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
      this.changed.fire();
    });
  }

  provideMcpServerDefinitions(_token?: vscode.CancellationToken): vscode.McpHttpServerDefinition[] {
    const version = this.generation === 0 ? undefined : String(this.generation);
    const definitions: vscode.McpHttpServerDefinition[] = [];
    for (const server of this.registry.servers) {
      const url = this.urlOf(server);
      if (url === undefined) continue;
      definitions.push(new vscode.McpHttpServerDefinition(labelOf(server), vscode.Uri.parse(url), {}, version));
    }
    return definitions;
  }

  async resolveMcpServerDefinition(
    definition: vscode.McpHttpServerDefinition,
    _token?: vscode.CancellationToken
  ): Promise<vscode.McpHttpServerDefinition> {
    const server = this.registry.servers.find((candidate) => labelOf(candidate) === definition.label);
    if (!server) throw new Error(`Unknown MCP server: ${definition.label}`);
    await server.start();
    const info = server.getInfo();
    if (info.state === 'unavailable') throw new Error(info.reason ?? `${server.label} is unavailable`);
    if (info.state !== 'running' || info.url === undefined) throw new Error(`${server.label} server is not running`);
    const token = await this.tokens.getToken(server.id, this.scopeKey());
    return new vscode.McpHttpServerDefinition(definition.label, vscode.Uri.parse(info.url), { Authorization: `Bearer ${token}` }, definition.version);
  }

  /** Tells VS Code to ask again. `newToken` marks every definition as changed so clients re-read the token. */
  notifyChanged(options: { newToken?: boolean } = {}): void {
    if (options.newToken) this.generation++;
    this.lastSignature = this.signature();
    this.changed.fire();
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }

  /** The URL a definition points at: where the server runs, or where it will run; undefined when not offered. */
  private urlOf(server: EmbeddedServerAdapter): string | undefined {
    const info = server.getInfo();
    if (info.state === 'unavailable') return undefined;
    if (info.state === 'running' && info.url !== undefined) return info.url;
    const port = server.plannedPort();
    return port === undefined || port === 0 ? undefined : `http://127.0.0.1:${String(port)}/mcp`;
  }

  private signature(): string {
    return JSON.stringify([this.generation, this.registry.servers.map((server) => [labelOf(server), this.urlOf(server) ?? null])]);
  }
}

/** Registers the provider with VS Code when the host has the MCP API (>= 1.101); otherwise returns undefined. */
export function registerMcpProvider(
  registry: ServerRegistry<EmbeddedServerAdapter>,
  tokens: TokenProvider,
  scopeKey: () => string
): (vscode.Disposable & { provider: McpServersDefinitionProvider }) | undefined {
  if (typeof (vscode as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm?.registerMcpServerDefinitionProvider !== 'function') {
    return undefined;
  }
  const provider = new McpServersDefinitionProvider(registry, tokens, scopeKey);
  const registration = vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider);
  return {
    provider,
    dispose: () => {
      registration.dispose();
      provider.dispose();
    },
  };
}
