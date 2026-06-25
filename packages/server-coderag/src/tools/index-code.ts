import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Indexer } from '../indexer/indexer.js';

const IndexCodeSchema = z.object({
  filepath: z.string().optional().describe('Single source code file to index'),
  directory: z.string().optional().describe('Directory to recursively index all supported code files'),
  filepaths: z.string().optional().describe('Comma-separated list of files to index'),
  directories: z.string().optional().describe('Comma-separated list of directories to recursively index'),
  exclude: z.string().optional().describe('Comma-separated glob patterns for files/directories to exclude (e.g. "**/*.test.ts,dist/**,node_modules")'),
  force: z.boolean().optional().describe('Force re-index even if file is unchanged (default: false)'),
});

export function registerIndexCode(server: McpServer, indexer: Indexer): void {
  server.registerTool(
    'index_code',
    {
      description: `Index source code for semantic search. Parses AST symbols (functions, classes, methods).
Supported: .ts .tsx .js .jsx .py .go .rs .java .cs .cpp .c .rb .php .sh .vue
Provide one or more of: filepath, filepaths, directory, directories.
Use exclude to skip files/folders by glob pattern (e.g. "**/*.test.ts", "dist/**", "node_modules").`,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Single source code file to index' },
          directory: { type: 'string', description: 'Directory to recursively index all supported code files' },
          filepaths: { type: 'string', description: 'Comma-separated list of files to index' },
          directories: { type: 'string', description: 'Comma-separated list of directories to recursively index' },
          exclude: { type: 'string', description: 'Comma-separated glob patterns to exclude (e.g. "**/*.test.ts,dist/**")' },
          force: { type: 'boolean', description: 'Force re-index even if file is unchanged (default: false)' },
        },
      }),
    },
    async (input: unknown) => {
      const { filepath, directory, filepaths, directories, exclude, force } = IndexCodeSchema.parse(input);

      if (!filepath && !directory && !filepaths && !directories) {
        throw new Error('At least one of filepath, filepaths, directory, or directories is required');
      }

      const excludePatterns = exclude ? exclude.split(',').map((p) => p.trim()).filter(Boolean) : [];
      const results: { file?: string; directory?: string; success: boolean; error?: string; indexed?: number; skipped?: number; failed?: number }[] = [];

      if (filepath) {
        try {
          await indexer.indexCodeFile(filepath);
          results.push({ file: filepath, success: true });
        } catch (err) {
          results.push({ file: filepath, success: false, error: String(err) });
        }
      }

      if (filepaths) {
        const files = filepaths.split(',').map((f) => f.trim()).filter(Boolean);
        for (const f of files) {
          try {
            await indexer.indexCodeFile(f);
            results.push({ file: f, success: true });
          } catch (err) {
            results.push({ file: f, success: false, error: String(err) });
          }
        }
      }

      if (directory) {
        try {
          const r = await indexer.indexCodeDirectory(directory, force ?? false, excludePatterns);
          results.push({ directory, success: true, ...r });
        } catch (err) {
          void server.sendLoggingMessage({ level: 'error', logger: 'index_code', data: `indexCodeDirectory failed for ${directory}: ${String(err)}` }).catch(() => {});
          results.push({ directory, success: false, error: String(err) });
        }
      }

      if (directories) {
        const dirs = directories.split(',').map((d) => d.trim()).filter(Boolean);
        for (const d of dirs) {
          try {
            const r = await indexer.indexCodeDirectory(d, force ?? false, excludePatterns);
            results.push({ directory: d, success: true, ...r });
          } catch (err) {
            void server.sendLoggingMessage({ level: 'error', logger: 'index_code', data: `indexCodeDirectory failed for ${d}: ${String(err)}` }).catch(() => {});
            results.push({ directory: d, success: false, error: String(err) });
          }
        }
      }

      void server.sendLoggingMessage({ level: 'info', logger: 'index_code', data: { results } }).catch(() => {});
      return {
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      };
    }
  );
}
