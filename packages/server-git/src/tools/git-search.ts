import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';
import { assertSafeRefLike } from '../core/git-args.js';

const GitSearchSchema = z.object({
  repository: z.string().describe('Repository path'),
  query: z.string().describe('Search query string'),
  search_type: z.enum(['message', 'diff']).optional().describe('Search type: message (default) or diff'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results to return (1-100, default: 20)'),
  branch: z.string().optional().describe('Branch to search (omit for current branch)'),
});

export function registerGitSearch(server: McpServer, services: Services): void {
  server.registerTool(
    'git_search',
    {
      description: 'Search commit messages and diffs',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          query: { type: 'string', description: 'Search query string' },
          search_type: {
            type: 'string',
            enum: ['message', 'diff'],
            description: 'Search type: message (grep commit messages, default) or diff (search patch content with -S)',
          },
          limit: { type: 'integer', description: 'Max results to return (1-100, default: 20)' },
          branch: { type: 'string', description: 'Branch to search (omit for current branch)' },
        },
        required: ['repository', 'query'],
      }),
    },
    async (input: unknown) => {
      const { repository, query, search_type = 'message', limit = 20, branch } = GitSearchSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['log', '--format=%H|%an|%ad|%s', '-n', String(limit)];
      if (search_type === 'diff') {
        args.push('-S', query);
      } else {
        args.push(`--grep=${query}`);
      }
      // Options first, then the revision: nothing after --end-of-options can be parsed as an option.
      if (branch) args.push('--end-of-options', assertSafeRefLike(branch, 'branch'));

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_search', repository, query, error: result.stderr });
        throw new Error(`Git search failed: ${result.stderr}`);
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
        content: [{ type: 'text', text: JSON.stringify({ success: true, query, search_type, commits, count: commits.length }, null, 2) }],
      };
    }
  );
}
