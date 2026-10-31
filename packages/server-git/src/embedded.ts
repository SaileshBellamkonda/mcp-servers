import { McpServer } from '@modelcontextprotocol/server';
import { McpLogger, createHostSink } from '@mcp-servers/common';
import { requireToken, startMcpHttpServer } from '@mcp-servers/http-host';
import { createGitServer } from './server/git-server.ts';
import { RepositoryManager } from './core/repository-manager.ts';

/**
 * Receives host-level diagnostics. Declared here, not imported, because the shared packages are bundled
 * at build time and the published declarations must not reference them.
 */
export interface GitServerLogger {
  /** Optional: git commands are logged at debug level, and dropped when the host has no debug output. */
  debug?(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

export interface ActivateGitServerOptions {
  /** Repositories the server may operate on. Must not be empty. */
  workspaceFolders: string[];
  /** TCP port on 127.0.0.1 (default 3000; 0 picks a free port). */
  port?: number;
  /** Bearer token clients must send (>= 32 characters). Required: embedded servers always authenticate. */
  authToken: string;
  /** Receives host-level diagnostics and what the tools log (defaults to nowhere). */
  logger?: GitServerLogger;
}

export interface GitServerInstance {
  /** The port actually bound. */
  port: number;
  /** The bound host (always the IPv4 loopback address). */
  host: string;
  /** Stops accepting connections and closes every session. */
  close(): Promise<void>;
  /** Replaces the repositories the running server may operate on. */
  updateAllowedRepositories(workspaceFolders: string[]): void;
}

export async function activateGitServer(options: ActivateGitServerOptions): Promise<GitServerInstance> {
  const { workspaceFolders } = options;
  if (workspaceFolders.length === 0) {
    throw new Error('No workspace folders provided for Git MCP Server');
  }
  const token = requireToken(options.authToken);

  // Created once; every session gets its own McpServer over the same repository manager.
  const repoManager = new RepositoryManager(workspaceFolders);
  const sink = createHostSink(options.logger);

  const httpServer = await startMcpHttpServer({
    createServer: () => {
      const server = new McpServer(
        { name: 'git-server', version: '1.0.0' },
        { capabilities: { tools: {}, logging: {} } }
      );
      createGitServer(server, repoManager, new McpLogger(server, 'git-server', sink));
      return server;
    },
    port: options.port ?? 3000,
    host: '127.0.0.1',
    token,
    ...(options.logger !== undefined && { logger: options.logger }),
  });

  return {
    port: httpServer.port,
    host: httpServer.host,
    close: () => httpServer.close(),
    updateAllowedRepositories: (folders) => { updateAllowedRepositories(repoManager, folders, options.logger); },
  };
}

export async function deactivateGitServer(instance: GitServerInstance): Promise<void> {
  await instance.close();
}

export function updateAllowedRepositories(
  repoManager: RepositoryManager,
  workspaceFolders: string[],
  logger?: GitServerLogger
): void {
  repoManager.updateAllowedRepositories(workspaceFolders);
  logger?.info(`Updated allowed repositories: ${workspaceFolders.join(', ')}`);
}
