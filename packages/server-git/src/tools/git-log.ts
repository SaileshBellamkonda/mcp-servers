import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitLogSchema = z.object({
  repository: z.string().describe('Repository path'),
  limit: z.number().min(1).max(100).default(10).describe('Maximum number of commits'),
  branch: z.string().optional().describe('Branch name')
});

export function registerGitLog(server: McpServer, services: Services): void {
  server.registerTool(
    'git_log',
    {
      description: 'Get commit history for a repository',
      inputSchema: GitLogSchema
    },
    async (input) => {
      const { repository, limit, branch } = GitLogSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      const args = ['log', `--format=%H|%an|%ad|%s`, `-n`, limit.toString()];
      if (branch) {
        args.push(branch);
      }
      
      const result = await services.gitExecutor.execute(repository, args);
      
      if (!result.success) {
        throw new Error(`Git log failed: ${result.stderr}`);
      }
      
      const commits = services.outputParser.parseLog(result.stdout);
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ commits }, null, 2) }]
      };
    }
  );
}
