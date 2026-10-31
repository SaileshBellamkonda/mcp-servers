import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.ts';
import { assertSafeRefLike } from '../core/git-args.ts';

const GitTagSchema = z.object({
  repository: z.string().describe('Repository path'),
  action: z.enum(['list', 'create', 'delete']).describe('Tag action to perform'),
  name: z.string().optional().describe('Tag name (required for create/delete)'),
  message: z.string().optional().describe('Annotated tag message (for create)'),
  ref: z
    .string()
    .optional()
    .describe('Commit or branch to tag (defaults to HEAD for create)'),
});

export function registerGitTag(server: McpServer, services: Services): void {
  server.registerTool(
    'git_tag',
    {
      description: 'List, create, or delete tags',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          action: {
            type: 'string',
            enum: ['list', 'create', 'delete'],
            description: 'Tag action to perform',
          },
          name: { type: 'string', description: 'Tag name (required for create/delete)' },
          message: {
            type: 'string',
            description: 'Annotated tag message (for create)',
          },
          ref: {
            type: 'string',
            description: 'Commit or branch to tag (defaults to HEAD for create)',
          },
        },
        required: ['repository', 'action'],
      }),
    },
    async (input: unknown) => {
      const { repository, action, name, message, ref } = GitTagSchema.parse(input);

      services.repoManager.validateRepository(repository);

      if ((action === 'create' || action === 'delete') && name === undefined) {
        throw new Error(`Git tag failed: "name" is required for action "${action}".`);
      }

      const tagName = name === undefined ? '' : assertSafeRefLike(name, 'tag name');
      if (ref !== undefined) assertSafeRefLike(ref, 'ref');

      let args: string[];

      switch (action) {
        case 'list':
          args = ['tag', '--sort=-version:refname'];
          break;
        case 'create':
          // tagName is non-empty here: "name" is required for create, validated above
          if (message !== undefined) {
            args = ['tag', '-a', tagName, '-m', message];
          } else {
            args = ['tag', tagName];
          }
          if (ref !== undefined) {
            args.push(ref);
          }
          break;
        case 'delete':
          args = ['tag', '-d', tagName];
          break;
      }

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_tag', repository, error: result.stderr });
        throw new Error(`Git tag failed: ${result.stderr}`);
      }

      if (action === 'list') {
        const tags = result.stdout
          .split('\n')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, tags }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                action,
                name,
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
