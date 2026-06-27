import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

// ─── git_remote_list ──────────────────────────────────────────────────────────

const GitRemoteListSchema = z.object({
  repository: z.string().describe('Repository path'),
});

export function registerGitRemoteList(server: McpServer, services: Services): void {
  server.registerTool(
    'git_remote_list',
    {
      description: 'List configured remotes for a repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository } = GitRemoteListSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const result = await services.gitExecutor.execute(repository, ['remote', '-v']);

      if (!result.success) {
        services.logger?.error({ tool: 'git_remote_list', repository, error: result.stderr });
        throw new Error(`Git remote list failed: ${result.stderr}`);
      }

      // Lines: "origin\thttps://...\t(fetch)" — deduplicate by remote name
      const seen = new Set<string>();
      const remotes: Array<{ name: string; url: string }> = [];

      for (const line of result.stdout.split('\n').filter(Boolean)) {
        const [name, urlWithType] = line.split('\t');
        const url = (urlWithType ?? '').replace(/\s+\(fetch\)|\s+\(push\)/, '').trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          remotes.push({ name, url });
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, remotes }, null, 2) }],
      };
    }
  );
}

// ─── git_remote_add ───────────────────────────────────────────────────────────

const GitRemoteAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  name: z.string().min(1).describe('Remote name (e.g. origin)'),
  url: z.string().min(1).describe('Remote URL'),
});

export function registerGitRemoteAdd(server: McpServer, services: Services): void {
  server.registerTool(
    'git_remote_add',
    {
      description: 'Add a new remote to a repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          name: { type: 'string', description: 'Remote name (e.g. origin)' },
          url: { type: 'string', description: 'Remote URL' },
        },
        required: ['repository', 'name', 'url'],
      }),
    },
    async (input: unknown) => {
      const { repository, name, url } = GitRemoteAddSchema.parse(input);

      services.repoManager.validateRepository(repository);

      if (!url.trim()) {
        throw new Error('Remote URL must not be empty');
      }

      const result = await services.gitExecutor.execute(repository, ['remote', 'add', name, url]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_remote_add', repository, name, error: result.stderr });
        throw new Error(`Git remote add failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, name, url }, null, 2) }],
      };
    }
  );
}

// ─── git_remote_remove ────────────────────────────────────────────────────────

const GitRemoteRemoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  name: z.string().min(1).describe('Remote name to remove'),
});

export function registerGitRemoteRemove(server: McpServer, services: Services): void {
  server.registerTool(
    'git_remote_remove',
    {
      description: 'Remove a remote from a repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          name: { type: 'string', description: 'Remote name to remove' },
        },
        required: ['repository', 'name'],
      }),
    },
    async (input: unknown) => {
      const { repository, name } = GitRemoteRemoveSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const result = await services.gitExecutor.execute(repository, ['remote', 'remove', name]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_remote_remove', repository, name, error: result.stderr });
        throw new Error(`Git remote remove failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, name }, null, 2) }],
      };
    }
  );
}
