import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitPullSchema = z.object({
  repository: z.string().describe('Repository path'),
  remote: z.string().default('origin').describe('Remote name'),
  branch: z.string().optional().describe('Branch to pull'),
  rebase: z.boolean().default(false).describe('Rebase instead of merge'),
});

export function registerGitPull(server: McpServer, services: Services): void {
  server.registerTool(
    'git_pull',
    {
      description: 'Pull changes from remote',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          remote: { type: 'string', description: 'Remote name' },
          branch: { type: 'string', description: 'Branch to pull' },
          rebase: { type: 'boolean', description: 'Rebase instead of merge' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, remote, branch, rebase } = GitPullSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['pull'];
      if (rebase) {
        args.push('--rebase');
      }
      args.push(remote);
      if (branch !== undefined) {
        args.push(branch);
      }

      const result = await services.gitExecutor.execute(repository, args);

      const combinedOutput = result.stdout + result.stderr;
      const hasConflict =
        combinedOutput.includes('CONFLICT') ||
        (!result.success && combinedOutput.toLowerCase().includes('conflict'));

      if (hasConflict) {
        const conflicts = combinedOutput
          .split('\n')
          .filter((line) => line.includes('CONFLICT'));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  conflicts,
                  message: 'Pull resulted in conflicts. Resolve conflicts and commit.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (!result.success) {
        services.logger?.error({ tool: 'git_pull', repository, error: result.stderr });
        throw new Error(`Git pull failed: ${result.stderr}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                remote,
                ...(branch !== undefined && { branch }),
                rebase,
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
