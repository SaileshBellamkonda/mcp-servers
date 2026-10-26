import type { ServerDescriptor } from '../core/server-descriptor';

/**
 * The Git MCP server: operates on the repositories of the workspace folders, so it needs an open folder
 * (`requiresWorkspace`, reported by the adapter as "Open a folder to use the Git server"). Folder changes
 * re-scope the running server in place.
 */
export const gitDescriptor: ServerDescriptor = {
  id: 'git',
  label: 'Git',
  settingsSection: 'mcpServers.git',
  defaultPort: 3000,
  requiresWorkspace: true,

  isAvailable: () => ({ available: true }),

  async activate(context) {
    // Loaded on first use so the server code is not evaluated until a server actually starts.
    const { activateGitServer } = await context.loadModule('@mcp-servers/server-git/embedded');
    const instance = await activateGitServer({
      workspaceFolders: context.workspaceFolders,
      port: context.port,
      authToken: context.authToken,
      logger: context.logger,
    });
    return {
      port: instance.port,
      host: instance.host,
      close: () => instance.close(),
      updateWorkspaceFolders: (folders) => {
        instance.updateAllowedRepositories(folders);
        return Promise.resolve();
      },
    };
  },
};
