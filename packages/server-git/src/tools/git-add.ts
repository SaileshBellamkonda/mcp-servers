import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GitMcpError, ErrorCode } from '../core/types.js';
import type { Services } from '../core/types.js';

const GitAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  files: z.array(z.string()).min(1).describe('Array of file paths to stage'),
});

export function registerGitAdd(server: McpServer, services: Services): void {
  server.registerTool(
    'git_add',
    {
      description: 'Stage files for commit',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          files: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to stage' },
        },
        required: ['repository', 'files'],
      }),
    },
    async (input: unknown) => {
      const { repository, files } = GitAddSchema.parse(input);

      services.repoManager.validateRepository(repository);

      if (files.includes('.') || files.includes('-A') || files.includes('*')) {
        throw new GitMcpError(
          ErrorCode.VALIDATION_ERROR,
          'Must specify explicit file paths, wildcards not allowed',
          { files }
        );
      }

      services.pathValidator.validatePaths(repository, files);

      const result = await services.gitExecutor.execute(repository, ['add', ...files]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_add', repository, error: result.stderr });
        throw new Error(`Git add failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, staged: files }, null, 2) }],
      };
    }
  );
}
