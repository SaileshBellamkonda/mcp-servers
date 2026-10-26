import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { assertFrontmatterFile } from '../indexer/loaders/index.js';
import { parseFrontmatter, stringifyFrontmatter } from '../indexer/loaders/markdown.js';
import type { PathGuard } from '../core/path-guard.js';

const UpdateFrontmatterSchema = z.object({
  filepath: z.string().min(1).describe('Path to the markdown file'),
  domain: z.string().optional(),
  doc_type: z.string().optional(),
  language: z.string().optional(),
  tags: z.string().optional().describe('Comma-separated tags — replaces existing tags'),
  project: z.string().optional(),
});

export function registerUpdateFrontmatter(server: McpServer, pathGuard: PathGuard): void {
  server.registerTool(
    'update_frontmatter',
    {
      description: 'Update (merge) YAML frontmatter fields in a markdown file.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Path to the markdown file' },
          domain: { type: 'string' },
          doc_type: { type: 'string' },
          language: { type: 'string' },
          tags: { type: 'string', description: 'Comma-separated tags — replaces existing tags' },
          project: { type: 'string' },
        },
        required: ['filepath'],
      }),
    },
    (input: unknown) => {
      const { filepath: requested, domain, doc_type, language, tags, project } = UpdateFrontmatterSchema.parse(input);
      const filepath = pathGuard.assertAllowed(requested);
      assertFrontmatterFile(filepath);
      const raw = readFileSync(filepath, 'utf8');
      const parsed = parseFrontmatter(raw);

      if (domain) parsed.data['domain'] = domain;
      if (doc_type) parsed.data['doc_type'] = doc_type;
      if (language) parsed.data['language'] = language;
      if (tags) parsed.data['tags'] = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (project) parsed.data['project'] = project;
      parsed.data['updated_at'] = new Date().toISOString().split('T')[0];

      const output = stringifyFrontmatter(parsed.content, parsed.data);
      writeFileSync(filepath, output, 'utf8');

      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ success: true, filepath }) }],
      });
    }
  );
}
