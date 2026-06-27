import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitPushSchema = z.object({
  repository: z.string().describe('Repository path'),
  remote: z.string().default('origin').describe('Remote name'),
  branch: z.string().optional().describe('Branch to push (defaults to current branch)'),
  force: z.boolean().default(false).describe('Force push — use with caution'),
});

export function registerGitPush(server: McpServer, services: Services): void {
  server.registerTool(
    'git_push',
    {
      description: 'Push commits to remote',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          remote: { type: 'string', description: 'Remote name' },
          branch: {
            type: 'string',
            description: 'Branch to push (defaults to current branch)',
          },
          force: { type: 'boolean', description: 'Force push — use with caution' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, remote, branch, force } = GitPushSchema.parse(input);

      services.repoManager.validateRepository(repository);

      // Resolve the target branch name
      let targetBranch = branch;
      if (targetBranch === undefined) {
        // Read current branch from HEAD
        const headResult = await services.gitExecutor.execute(repository, [
          'rev-parse',
          '--abbrev-ref',
          'HEAD',
        ]);
        if (!headResult.success) {
          services.logger?.error({ tool: 'git_push', repository, error: headResult.stderr });
          throw new Error(`Git push failed: unable to determine current branch: ${headResult.stderr}`);
        }
        targetBranch = headResult.stdout.trim();
      }

      // Enforce branch allowlist if configured
      const allowedBranchesEnv = process.env['GIT_PUSH_ALLOWED_BRANCHES'];
      if (allowedBranchesEnv !== undefined && allowedBranchesEnv.trim() !== '') {
        const allowedBranches = allowedBranchesEnv.split(';').map((b) => b.trim());
        const allowAll = allowedBranches.includes('*');
        if (!allowAll && !allowedBranches.includes(targetBranch)) {
          throw new Error(
            `Git push failed: branch "${targetBranch}" is not in the allowed list (GIT_PUSH_ALLOWED_BRANCHES).`,
          );
        }
      }

      const args = ['push'];
      if (force) {
        args.push('--force');
      }
      args.push(remote, targetBranch);

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_push', repository, error: result.stderr });
        throw new Error(`Git push failed: ${result.stderr}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                remote,
                branch: targetBranch,
                force,
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
