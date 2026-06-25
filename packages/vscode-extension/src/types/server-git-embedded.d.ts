declare module '@mcp-servers/server-git/embedded' {
  import type { Server } from 'node:http';

  export function activateGitServer(
    paths: string[],
    port?: number
  ): Promise<{
    server: object;
    app: object;
    httpServer: Server;
    transports: Map<string, object>;
  }>;
}
