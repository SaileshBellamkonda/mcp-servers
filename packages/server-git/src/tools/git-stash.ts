import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitStashSchema = z.object({
  repository: z.string().describe('Repository path'),
  action: z.enum(['push', 'pop', 'list', 'drop']).describe('Stash action to perform'),
  message: z.string().optional().describe('Stash message (only for action "push")'),
  index: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('0-based stash index for "pop" or "drop"'),
});

interface StashEntry {
  index: number;
  message: string;
  branch: string;
  hash: string;
}

function parseStashList(output: string): StashEntry[] {
  const entries: StashEntry[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: stash@{N}: WIP on <branch>: <hash> <message>
    const match = /^stash@\{(\d+)\}:\s+WIP on ([^:]+):\s+([a-f0-9]+)\s+(.*)$/.exec(trimmed);
    if (match) {
      const [, idx = '', branch = '', hash = '', message = ''] = match;
      entries.push({
        index: parseInt(idx, 10),
        branch: branch.trim(),
        hash,
        message: message.trim(),
      });
    } else {
      // Fallback: try to extract what we can
      const fallbackMatch = /^stash@\{(\d+)\}:\s+(.*)$/.exec(trimmed);
      if (fallbackMatch) {
        const [, idx = '', message = ''] = fallbackMatch;
        entries.push({
          index: parseInt(idx, 10),
          branch: '',
          hash: '',
          message: message.trim(),
        });
      }
    }
  }
  return entries;
}

export function registerGitStash(server: McpServer, services: Services): void {
  server.registerTool(
    'git_stash',
    {
      description: 'Manage stash entries (save, pop, list, drop)',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          action: {
            type: 'string',
            enum: ['push', 'pop', 'list', 'drop'],
            description: 'Stash action to perform',
          },
          message: {
            type: 'string',
            description: 'Stash message (only for action "push")',
          },
          index: {
            type: 'number',
            description: '0-based stash index for "pop" or "drop"',
          },
        },
        required: ['repository', 'action'],
      }),
    },
    async (input: unknown) => {
      const { repository, action, message, index } = GitStashSchema.parse(input);

      services.repoManager.validateRepository(repository);

      let args: string[];

      switch (action) {
        case 'push':
          args = ['stash', 'push'];
          if (message !== undefined) {
            args.push('-m', message);
          }
          break;
        case 'pop':
          args = ['stash', 'pop', `stash@{${String(index)}}`];
          break;
        case 'list':
          args = ['stash', 'list'];
          break;
        case 'drop':
          args = ['stash', 'drop', `stash@{${String(index)}}`];
          break;
      }

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_stash', repository, error: result.stderr });
        throw new Error(`Git stash failed: ${result.stderr}`);
      }

      if (action === 'list') {
        const stashes = parseStashList(result.stdout);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, stashes }, null, 2),
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
