import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GitMcpError, ErrorCode } from '../core/types.js';
import type { Services } from '../core/types.js';

const GitCommitSchema = z.object({
  repository: z.string().describe('Repository path'),
  message: z.string().min(1).max(500).describe('Commit message')
});

export function registerGitCommit(server: McpServer, services: Services): void {
  server.registerTool(
    'git_commit',
    {
      description: 'Commit staged changes',
      inputSchema: GitCommitSchema
    },
    async (input) => {
      const { repository, message } = GitCommitSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      // Sanitize message (remove control characters)
      const sanitized = message.replace(/[\x00-\x1F\x7F]/g, '');
      
      const result = await services.gitExecutor.execute(repository, ['commit', '-m', sanitized]);
      
      if (!result.success) {
        throw new Error(`Git commit failed: ${result.stderr}`);
      }
      
      // Extract commit hash from output
      const hashMatch = result.stdout.match(/\[.+\s([a-f0-9]+)\]/);
      const commit = hashMatch ? hashMatch[1] : 'unknown';
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, commit, message: sanitized }, null, 2) }]
      };
    }
  );
}
