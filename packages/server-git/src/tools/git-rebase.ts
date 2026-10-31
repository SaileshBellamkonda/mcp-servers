import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.ts';
import { assertSafeRefLike } from '../core/git-args.ts';

const GitRebaseSchema = z.object({
  repository: z.string().describe('Repository path'),
  onto: z.string().describe('Branch or commit to rebase onto'),
  abort: z.boolean().default(false).describe('Abort an in-progress rebase'),
  continue_: z.boolean().default(false).describe('Continue after resolving conflicts'),
});

export function registerGitRebase(server: McpServer, services: Services): void {
  server.registerTool(
    'git_rebase',
    {
      description: 'Rebase current branch onto another',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          onto: { type: 'string', description: 'Branch or commit to rebase onto' },
          abort: { type: 'boolean', description: 'Abort an in-progress rebase' },
          continue: {
            type: 'boolean',
            description: 'Continue after resolving conflicts',
          },
        },
        required: ['repository', 'onto'],
      }),
    },
    async (input: unknown) => {
      // Map JSON 'continue' field to the Zod 'continue_' field before parsing
      const rawInput = input as Record<string, unknown>;
      const mapped = {
        ...rawInput,
        continue_:
          rawInput['continue_'] !== undefined
            ? rawInput['continue_']
            : rawInput['continue'],
      };

      const { repository, onto, abort, continue_ } = GitRebaseSchema.parse(mapped);

      services.repoManager.validateRepository(repository);

      let args: string[];
      if (abort) {
        args = ['rebase', '--abort'];
      } else if (continue_) {
        args = ['rebase', '--continue'];
      } else {
        args = ['rebase', assertSafeRefLike(onto, 'onto')];
      }

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
        services.logger?.error({ tool: 'git_rebase', repository, error: result.stderr });
        throw new Error(`Git rebase failed: ${result.stderr}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                ...(!(abort || continue_) && { onto }),
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
