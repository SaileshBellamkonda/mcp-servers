import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Path for new worktree'),
  branch: z.string().optional().describe('Branch name'),
  commitish: z.string().optional().describe('Commit-ish reference')
});

export function registerGitWorktreeAdd(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_add',
    {
      description: 'Create a new worktree',
      inputSchema: GitWorktreeAddSchema
    },
    async (input) => {
      const { repository, path, branch, commitish } = GitWorktreeAddSchema.parse(input);
      services.repoManager.validateRepository(repository);
      services.pathValidator.validatePath(repository, path);
      
      const args = ['worktree', 'add', path];
      if (branch) args.push('-b', branch);
      if (commitish) args.push(commitish);
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree add failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, path, branch }, null, 2) }] };
    }
  );
}
