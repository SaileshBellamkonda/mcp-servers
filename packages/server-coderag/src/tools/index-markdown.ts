import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Indexer } from '../indexer/indexer.js';

const IndexMarkdownSchema = z.object({
  filepath: z.string().optional().describe('Path to a single markdown file to index'),
  filepaths: z.string().optional().describe('Comma-separated list of markdown files to index'),
  directory: z.string().optional().describe('Directory to recursively index all markdown (.md) files'),
  directories: z.string().optional().describe('Comma-separated list of directories to recursively index'),
  exclude: z.string().optional().describe('Comma-separated glob patterns for files/directories to exclude (e.g. "drafts/**,**/*.draft.md")'),
  force: z.boolean().optional().describe('Force re-index even if file is unchanged (default: false)'),
});

export function registerIndexMarkdown(server: McpServer, indexer: Indexer): void {
  server.registerTool(
    'index_markdown',
    {
      description: `Index markdown files for semantic search. Chunks by paragraph and generates embeddings.
Provide one or more of: filepath, filepaths, directory, directories.
Use exclude to skip files/folders by glob pattern (e.g. "drafts/**", "**/*.draft.md").`,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Path to a single markdown file to index' },
          filepaths: { type: 'string', description: 'Comma-separated list of markdown files to index' },
          directory: { type: 'string', description: 'Directory to recursively index all markdown (.md) files' },
          directories: { type: 'string', description: 'Comma-separated list of directories to recursively index for markdown files' },
          exclude: { type: 'string', description: 'Comma-separated glob patterns to exclude (e.g. "drafts/**,**/*.draft.md")' },
          force: { type: 'boolean', description: 'Force re-index even if file is unchanged (default: false)' },
        },
      }),
    },
    async (input: unknown) => {
      const { filepath, filepaths, directory, directories, exclude, force } = IndexMarkdownSchema.parse(input);

      if (!filepath && !filepaths && !directory && !directories) {
        throw new Error('At least one of filepath, filepaths, directory, or directories is required');
      }

      const excludePatterns = exclude ? exclude.split(',').map((p) => p.trim()).filter(Boolean) : [];
      const results: { file?: string; directory?: string; success: boolean; error?: string; indexed?: number; skipped?: number; failed?: number }[] = [];

      if (filepath) {
        try {
          await indexer.indexFile(filepath);
          results.push({ file: filepath, success: true });
        } catch (err) {
          results.push({ file: filepath, success: false, error: String(err) });
        }
      }

      if (filepaths) {
        const files = filepaths.split(',').map((f) => f.trim()).filter(Boolean);
        for (const f of files) {
          try {
            await indexer.indexFile(f);
            results.push({ file: f, success: true });
          } catch (err) {
            results.push({ file: f, success: false, error: String(err) });
          }
        }
      }

      if (directory) {
        try {
          const r = await indexer.indexMarkdownDirectory(directory, force ?? false, excludePatterns);
          results.push({ directory, success: true, ...r });
        } catch (err) {
          void server.sendLoggingMessage({ level: 'error', logger: 'index_markdown', data: `indexMarkdownDirectory failed for ${directory}: ${String(err)}` }).catch(() => {});
          results.push({ directory, success: false, error: String(err) });
        }
      }

      if (directories) {
        const dirs = directories.split(',').map((d) => d.trim()).filter(Boolean);
        for (const d of dirs) {
          try {
            const r = await indexer.indexMarkdownDirectory(d, force ?? false, excludePatterns);
            results.push({ directory: d, success: true, ...r });
          } catch (err) {
            void server.sendLoggingMessage({ level: 'error', logger: 'index_markdown', data: `indexMarkdownDirectory failed for ${d}: ${String(err)}` }).catch(() => {});
            results.push({ directory: d, success: false, error: String(err) });
          }
        }
      }

      void server.sendLoggingMessage({ level: 'info', logger: 'index_markdown', data: { results } }).catch(() => {});
      return {
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      };
    }
  );
}
