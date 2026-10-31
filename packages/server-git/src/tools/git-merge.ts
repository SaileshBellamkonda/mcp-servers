import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.ts';
import { assertSafeRefLike } from '../core/git-args.ts';

const GitMergeSchema = z.object({
  repository: z.string().describe('Repository path'),
  branch: z.string().describe('Branch to merge in'),
  no_ff: z.boolean().default(false).describe('Disable fast-forward merge'),
  message: z.string().optional().describe('Custom merge commit message'),
});

export function registerGitMerge(server: McpServer, services: Services): void {
  server.registerTool(
    'git_merge',
    {
      description: 'Merge a branch into the current branch',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          branch: { type: 'string', description: 'Branch to merge in' },
          no_ff: { type: 'boolean', description: 'Disable fast-forward merge' },
          message: { type: 'string', description: 'Custom merge commit message' },
        },
        required: ['repository', 'branch'],
      }),
    },
    async (input: unknown) => {
      const { repository, branch, no_ff, message } = GitMergeSchema.parse(input);

      services.repoManager.validateRepository(repository);

      assertSafeRefLike(branch, 'branch');

      const args = ['merge'];
      if (no_ff) {
        args.push('--no-ff');
      }
      if (message !== undefined) {
        args.push('-m', message);
      }
      args.push(branch);

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
        services.logger?.error({ tool: 'git_merge', repository, error: result.stderr });
        throw new Error(`Git merge failed: ${result.stderr}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                branch,
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
