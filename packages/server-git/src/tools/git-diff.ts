import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitDiffSchema = z.object({
  repository: z.string().describe('Repository path'),
  target: z.string().optional().describe('Diff target (file, commit, or branch)'),
  staged: z.boolean().default(false).describe('Show staged changes only')
});

export function registerGitDiff(server: McpServer, services: Services): void {
  server.registerTool(
    'git_diff',
    {
      description: 'Show changes in the repository',
      inputSchema: GitDiffSchema
    },
    async (input) => {
      const { repository, target, staged } = GitDiffSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      const args = ['diff'];
      if (staged) {
        args.push('--staged');
      }
      if (target) {
        args.push(target);
      }
      
      const result = await services.gitExecutor.execute(repository, args);
      
      if (!result.success) {
        throw new Error(`Git diff failed: ${result.stderr}`);
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ diff: result.stdout }, null, 2) }]
      };
    }
  );
}
