#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { McpLogger, createSinkFromEnv, createSinkLogger, parseList, parsePort, type LogSink } from '@mcp-servers/common';
import { resolveHttpSecurity, startMcpHttpServer } from '@mcp-servers/http-host';
import { createGitServer } from './server/git-server.ts';
import { RepositoryManager } from './core/repository-manager.ts';

function newServer(): McpServer {
  return new McpServer(
    { name: 'git-server', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
}

// The sink `main` logs to, kept so a crash can be recorded in the log file as well.
let fatalSink: LogSink | undefined;

async function main() {
  // Log entries go to LOG_FILE at LOG_LEVEL, or nowhere; an invalid LOG_LEVEL fails here, before anything starts.
  const sink = createSinkFromEnv(process.env);
  fatalSink = sink;
  const log = createSinkLogger('git-server', sink);
  const allowedReposEnv = process.env['GIT_ALLOWED_REPOS'];

  if (!allowedReposEnv) {
    console.error('Error: GIT_ALLOWED_REPOS environment variable not set');
    console.error('Usage: GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2" git-mcp-server');
    process.exit(1);
  }

  const allowedRepos = parseList(allowedReposEnv);

  if (allowedRepos.length === 0) {
    console.error('Error: No repositories configured in GIT_ALLOWED_REPOS');
    process.exit(1);
  }

  // Created once; every HTTP session shares it.
  const repoManager = new RepositoryManager(allowedRepos);

  if (process.env['MCP_TRANSPORT']?.toLowerCase() === 'http') {
    const { host, token } = resolveHttpSecurity(process.env);
    const port = parsePort(process.env['MCP_HTTP_PORT'], 3000);

    const httpServer = await startMcpHttpServer({
      createServer: () => {
        const server = newServer();
        createGitServer(server, repoManager, new McpLogger(server, 'git-server', sink));
        return server;
      },
      port,
      host,
      token,
      logger: createSinkLogger('http-host', sink),
    });
    log.info(`Git MCP Server ready. Allowed repositories: ${allowedRepos.join(', ')}`);

    const shutdown = async (): Promise<void> => {
      try {
        await httpServer.close();
      } catch (err) {
        log.error(`closing HTTP server: ${String(err)}`);
      }
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  } else {
    // Default: stdio, a single server
    const server = newServer();
    const logger = new McpLogger(server, 'git-server', sink);
    createGitServer(server, repoManager, logger);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`Git MCP Server ready. Allowed repositories: ${allowedRepos.join(', ')}`);

    const shutdown = async (): Promise<void> => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  }
}

main().catch((error: unknown) => {
  // A crash is reported on stderr even though servers never log there, and also recorded when a log file exists.
  fatalSink?.('critical', 'git-server', `FATAL ${String(error)}`);
  process.stderr.write(`[FATAL] ${String(error)}\n`);
  process.exit(1);
});
