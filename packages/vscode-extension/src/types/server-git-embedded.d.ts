declare module '@mcp-servers/server-git/embedded' {
  export function activateGitServer(
    paths: string[],
    port?: number
  ): Promise<{
    server: any;
    app: any;
    httpServer: { close(cb?: () => void): void };
    transports: Map<any, any>;
  }>;
}
