import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.ts';
import { assertSafeRefLike } from '../core/git-args.ts';

/** Only allow safe characters in commit refs — reject shell special chars */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._/~^:-]+$/;

const GitShowSchema = z.object({
  repository: z.string().describe('Repository path'),
  commit: z.string().describe('Commit hash or ref (e.g. HEAD, main, abc1234)'),
});

export function registerGitShow(server: McpServer, services: Services): void {
  server.registerTool(
    'git_show',
    {
      description: 'Show full diff and metadata for a specific commit',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          commit: { type: 'string', description: 'Commit hash or ref (e.g. HEAD, main, abc1234)' },
        },
        required: ['repository', 'commit'],
      }),
    },
    async (input: unknown) => {
      const { repository, commit } = GitShowSchema.parse(input);

      services.repoManager.validateRepository(repository);

      assertSafeRefLike(commit, 'commit');
      if (!SAFE_REF_PATTERN.test(commit)) {
        throw new Error(`Invalid commit ref: ${commit}`);
      }

      const result = await services.gitExecutor.execute(repository, ['show', commit]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_show', repository, commit, error: result.stderr });
        throw new Error(`Git show failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, commit, output: result.stdout }, null, 2) }],
      };
    }
  );
}
