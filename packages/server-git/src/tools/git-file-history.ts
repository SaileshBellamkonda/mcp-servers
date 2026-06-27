import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitFileHistorySchema = z.object({
  repository: z.string().describe('Repository path'),
  filepath: z.string().describe('Path to the file relative to repository root'),
  limit: z.number().int().min(1).max(100).optional().describe('Max commits to return (1-100, default: 20)'),
});

export function registerGitFileHistory(server: McpServer, services: Services): void {
  server.registerTool(
    'git_file_history',
    {
      description: 'Show commits that touched a specific file',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          filepath: { type: 'string', description: 'Path to the file relative to repository root' },
          limit: { type: 'integer', description: 'Max commits to return (1-100, default: 20)' },
        },
        required: ['repository', 'filepath'],
      }),
    },
    async (input: unknown) => {
      const { repository, filepath, limit = 20 } = GitFileHistorySchema.parse(input);

      services.repoManager.validateRepository(repository);
      services.pathValidator.validatePath(repository, filepath);

      const result = await services.gitExecutor.execute(repository, [
        'log',
        '--format=%H|%an|%ad|%s',
        '-n',
        String(limit),
        '--',
        filepath,
      ]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_file_history', repository, filepath, error: result.stderr });
        throw new Error(`Git file history failed: ${result.stderr}`);
      }

      const commits = result.stdout
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [hash, author, date, ...messageParts] = line.split('|');
          return {
            hash: hash ?? '',
            author: author ?? '',
            date: date ?? '',
            message: messageParts.join('|'),
          };
        });

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, filepath, commits, count: commits.length }, null, 2) }],
      };
    }
  );
}
