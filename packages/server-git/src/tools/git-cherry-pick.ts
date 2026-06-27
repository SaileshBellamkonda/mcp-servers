import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitCherryPickSchema = z.object({
  repository: z.string().describe('Repository path'),
  commits: z.array(z.string()).min(1).describe('List of commit hashes to cherry-pick'),
  no_commit: z
    .boolean()
    .default(false)
    .describe('Apply changes without creating a commit'),
});

export function registerGitCherryPick(server: McpServer, services: Services): void {
  server.registerTool(
    'git_cherry_pick',
    {
      description: 'Cherry-pick one or more commits onto the current branch',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          commits: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'List of commit hashes to cherry-pick',
          },
          no_commit: {
            type: 'boolean',
            description: 'Apply changes without creating a commit',
          },
        },
        required: ['repository', 'commits'],
      }),
    },
    async (input: unknown) => {
      const { repository, commits, no_commit } = GitCherryPickSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['cherry-pick'];
      if (no_commit) {
        args.push('--no-commit');
      }
      args.push(...commits);

      const result = await services.gitExecutor.execute(repository, args);

      const combinedOutput = result.stdout + result.stderr;
      if (result.exitCode !== 0 && combinedOutput.includes('CONFLICT')) {
        const conflicts = combinedOutput
          .split('\n')
          .filter((line) => line.includes('CONFLICT'));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: false, conflicts }, null, 2),
            },
          ],
        };
      }

      if (!result.success) {
        services.logger?.error({ tool: 'git_cherry_pick', repository, error: result.stderr });
        throw new Error(`Git cherry-pick failed: ${result.stderr}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                commits,
                no_commit,
                output: result.stdout || result.stderr,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
