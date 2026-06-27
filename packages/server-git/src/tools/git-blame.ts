import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

interface BlameEntry {
  line: number;
  hash: string;
  author: string;
  timestamp: string;
  content: string;
}

function parsePorcelainBlame(output: string): BlameEntry[] {
  const lines = output.split('\n');
  const result: BlameEntry[] = [];
  const commitMeta = new Map<string, { author: string; timestamp: string }>();

  let i = 0;
  while (i < lines.length) {
    const headerLine = lines[i];
    if (!headerLine?.trim()) { i++; continue; }

    // Each block starts with: <40-hex-hash> <orig_line> <final_line> [<count>]
    const m = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(headerLine);
    if (!m) { i++; continue; }

    const hash = m[1] ?? '';
    const lineNum = parseInt(m[2] ?? '0', 10);
    i++;

    let author = '';
    let timestamp = '';

    // Read metadata lines until the tab-prefixed content line
    while (i < lines.length) {
      const metaLine = lines[i] ?? '';
      if (metaLine.startsWith('\t')) break;
      if (metaLine.startsWith('author ') && !metaLine.startsWith('author-')) {
        author = metaLine.slice(7).trim();
      } else if (metaLine.startsWith('author-time ')) {
        const unix = parseInt(metaLine.slice(12).trim(), 10);
        timestamp = new Date(unix * 1000).toISOString();
      }
      i++;
    }

    // Subsequent references to the same commit omit metadata — use cached values
    const cached = commitMeta.get(hash);
    if (cached) {
      if (!author) author = cached.author;
      if (!timestamp) timestamp = cached.timestamp;
    } else {
      commitMeta.set(hash, { author, timestamp });
    }

    // Tab-prefixed content line
    const contentLine = lines[i] ?? '';
    const content = contentLine.startsWith('\t') ? contentLine.slice(1) : contentLine;
    i++;

    result.push({ line: lineNum, hash, author, timestamp, content });
  }

  return result;
}

const GitBlameSchema = z.object({
  repository: z.string().describe('Repository path'),
  filepath: z.string().describe('Path to the file relative to repository root'),
  start_line: z.number().int().positive().optional().describe('Start line number'),
  end_line: z.number().int().positive().optional().describe('End line number'),
});

export function registerGitBlame(server: McpServer, services: Services): void {
  server.registerTool(
    'git_blame',
    {
      description: 'Show per-line author, commit hash, and timestamp for a file',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          filepath: { type: 'string', description: 'Path to the file relative to repository root' },
          start_line: { type: 'integer', description: 'Start line number' },
          end_line: { type: 'integer', description: 'End line number' },
        },
        required: ['repository', 'filepath'],
      }),
    },
    async (input: unknown) => {
      const { repository, filepath, start_line, end_line } = GitBlameSchema.parse(input);

      services.repoManager.validateRepository(repository);
      services.pathValidator.validatePath(repository, filepath);

      const args = ['blame', '--porcelain'];
      if (start_line !== undefined || end_line !== undefined) {
        const start = start_line ?? 1;
        const end = end_line ?? start;
        args.push('-L', `${String(start)},${String(end)}`);
      }
      args.push('--', filepath);

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_blame', repository, filepath, error: result.stderr });
        throw new Error(`Git blame failed: ${result.stderr}`);
      }

      const lines = parsePorcelainBlame(result.stdout);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, filepath, lines }, null, 2) }],
      };
    }
  );
}
