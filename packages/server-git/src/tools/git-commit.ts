import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitCommitSchema = z.object({
  repository: z.string().describe('Repository path'),
  message: z.string().min(1).max(500).describe('Commit message'),
});

export function registerGitCommit(server: McpServer, services: Services): void {
  server.registerTool(
    'git_commit',
    {
      description: 'Commit staged changes',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          message: { type: 'string', description: 'Commit message' },
        },
        required: ['repository', 'message'],
      }),
    },
    async (input: unknown) => {
      const { repository, message } = GitCommitSchema.parse(input);

      services.repoManager.validateRepository(repository);

      // eslint-disable-next-line no-control-regex
      const sanitized = message.replace(/[\x00-\x1F\x7F]/g, '');

      const result = await services.gitExecutor.execute(repository, ['commit', '-m', sanitized]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_commit', repository, error: result.stderr });
        throw new Error(`Git commit failed: ${result.stderr}`);
      }

      const hashMatch = /\[.+\s([a-f0-9]+)\]/.exec(result.stdout);
      const commit = hashMatch ? hashMatch[1] : 'unknown';

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, commit, message: sanitized }, null, 2) }],
      };
    }
  );
}
