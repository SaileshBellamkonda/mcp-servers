import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GitMcpError, ErrorCode } from '../core/types.js';
import type { Services } from '../core/types.js';

const GitAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  files: z.array(z.string()).min(1).describe('Array of file paths to stage')
});

export function registerGitAdd(server: McpServer, services: Services): void {
  server.registerTool(
    'git_add',
    {
      description: 'Stage files for commit',
      inputSchema: GitAddSchema
    },
    async (input) => {
      const { repository, files } = GitAddSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      // Reject dangerous patterns
      if (files.includes('.') || files.includes('-A') || files.includes('*')) {
        throw new GitMcpError(
          ErrorCode.VALIDATION_ERROR,
          'Must specify explicit file paths, wildcards not allowed',
          { files }
        );
      }
      
      // Validate all file paths
      const validatedFiles = services.pathValidator.validatePaths(repository, files);
      
      const result = await services.gitExecutor.execute(repository, ['add', ...files]);
      
      if (!result.success) {
        throw new Error(`Git add failed: ${result.stderr}`);
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, staged: files }, null, 2) }]
      };
    }
  );
}
