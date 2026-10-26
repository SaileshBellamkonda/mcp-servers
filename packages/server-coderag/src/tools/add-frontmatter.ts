import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { assertFrontmatterFile } from '../indexer/loaders/index.js';
import { parseFrontmatter, stringifyFrontmatter } from '../indexer/loaders/markdown.js';
import type { PathGuard } from '../core/path-guard.js';

const AddFrontmatterSchema = z.object({
  filepath: z.string().min(1).describe('Path to the markdown file'),
  domain: z.string().optional().describe('Domain: frontend | backend | mobile | infrastructure | other'),
  doc_type: z.string().optional().describe('Document type: spec | design | api | guide | note | other'),
  language: z.string().optional().describe('Primary language: typescript | python | go | rust | java | other'),
  tags: z.string().optional().describe('Comma-separated tags (e.g. "auth,database,caching")'),
  project: z.string().optional().describe('Project name'),
});

export function registerAddFrontmatter(server: McpServer, pathGuard: PathGuard): void {
  server.registerTool(
    'add_frontmatter',
    {
      description: 'Add YAML frontmatter metadata to a markdown file. Prepends a new frontmatter block.',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Path to the markdown file' },
          domain: { type: 'string', description: 'Domain: frontend | backend | mobile | infrastructure | other' },
          doc_type: { type: 'string', description: 'Document type: spec | design | api | guide | note | other' },
          language: { type: 'string', description: 'Primary language: typescript | python | go | rust | java | other' },
          tags: { type: 'string', description: 'Comma-separated tags (e.g. "auth,database,caching")' },
          project: { type: 'string', description: 'Project name' },
        },
        required: ['filepath'],
      }),
    },
    (input: unknown) => {
      const { filepath: requested, domain, doc_type, language, tags, project } = AddFrontmatterSchema.parse(input);
      // Operate on the resolved path, and judge the file type by what the link points at, not its name.
      const filepath = pathGuard.assertAllowedReal(requested);
      assertFrontmatterFile(filepath);
      const raw = readFileSync(filepath, 'utf8');
      const parsed = parseFrontmatter(raw);

      // Only add if no frontmatter exists
      if (Object.keys(parsed.data).length > 0) {
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify({ success: false, message: 'Frontmatter already exists. Use update_frontmatter to modify it.' }) }],
        });
      }

      const newData: Record<string, unknown> = {};
      if (domain) newData['domain'] = domain;
      if (doc_type) newData['doc_type'] = doc_type;
      if (language) newData['language'] = language;
      if (tags) newData['tags'] = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (project) newData['project'] = project;
      newData['updated_at'] = new Date().toISOString().split('T')[0];

      const output = stringifyFrontmatter(parsed.content, newData);
      writeFileSync(filepath, output, 'utf8');

      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ success: true, filepath }) }],
      });
    }
  );
}
