import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Indexer } from '../indexer/indexer.ts';
import type { SyncManager } from '../indexer/sync-manager.ts';
import { syncLockedResponse } from '../indexer/sync-manager.ts';
import type { PathGuard } from '../core/path-guard.ts';

const IndexCodeSchema = z.object({
  filepath: z.string().optional(),
  directory: z.string().optional(),
  filepaths: z.string().optional(),
  directories: z.string().optional(),
  exclude: z.string().optional().describe('Semicolon-separated glob patterns to exclude'),
  force: z.boolean().optional(),
});

export function registerIndexCode(server: McpServer, indexer: Indexer, syncManager: SyncManager, pathGuard: PathGuard): void {
  server.registerTool(
    'index_code',
    {
      description: `Index source code for semantic search. Parses AST symbols (functions, classes, methods).
Supported: .ts .tsx .js .jsx .py .go .rs .java .cs .cpp .c .rb .php .sh .vue
Provide one or more of: filepath, filepaths, directory, directories.
Use exclude for semicolon-separated glob patterns (e.g. "**/*.test.ts;dist/**").
Returns { locked: true } if a sync operation is in progress.`,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Single source code file to index' },
          directory: { type: 'string', description: 'Directory to recursively index all supported code files' },
          filepaths: { type: 'string', description: 'Comma-separated list of files to index' },
          directories: { type: 'string', description: 'Comma-separated list of directories to recursively index' },
          exclude: { type: 'string', description: 'Semicolon-separated glob patterns to exclude (e.g. "**/*.test.ts;dist/**")' },
          force: { type: 'boolean', description: 'Force re-index even if file is unchanged (default: false)' },
        },
      }),
    },
    async (input: unknown) => {
      if (syncManager.inProgress) return syncLockedResponse(syncManager.status);

      const { filepath, directory, filepaths, directories, exclude, force } = IndexCodeSchema.parse(input);

      if (!filepath && !directory && !filepaths && !directories) {
        throw new Error('At least one of filepath, filepaths, directory, or directories is required');
      }

      const excludePatterns = exclude ? exclude.split(';').map((p) => p.trim()).filter(Boolean) : [];
      const results: { file?: string; directory?: string; success: boolean; error?: string; excluded?: boolean; indexed?: number; skipped?: number; failed?: number }[] = [];

      const indexSingleFile = async (f: string) => {
        let resolved: string;
        try {
          resolved = pathGuard.assertAllowed(f);
        } catch (err) {
          results.push({ file: f, success: false, error: String(err) });
          return;
        }
        if (indexer.isCodeExcluded(resolved)) {
          results.push({ file: f, success: false, excluded: true, error: 'File is excluded by configured code exclusion patterns' });
          return;
        }
        try {
          await indexer.indexCodeFile(resolved);
          results.push({ file: f, success: true });
        } catch (err) {
          results.push({ file: f, success: false, error: String(err) });
        }
      };

      if (filepath) await indexSingleFile(filepath);
      if (filepaths) {
        for (const f of filepaths.split(',').map((x) => x.trim()).filter(Boolean)) {
          await indexSingleFile(f);
        }
      }

      if (directory) {
        try {
          const r = await indexer.indexCodeDirectory(pathGuard.assertAllowed(directory), force ?? false, excludePatterns);
          results.push({ directory, success: true, ...r });
        } catch (err) {
          void server.sendLoggingMessage({ level: 'error', logger: 'index_code', data: `indexCodeDirectory failed for ${directory}: ${String(err)}` }).catch((_e: unknown) => { /* fire-and-forget log */ });
          results.push({ directory, success: false, error: String(err) });
        }
      }

      if (directories) {
        for (const d of directories.split(',').map((x) => x.trim()).filter(Boolean)) {
          try {
            const r = await indexer.indexCodeDirectory(pathGuard.assertAllowed(d), force ?? false, excludePatterns);
            results.push({ directory: d, success: true, ...r });
          } catch (err) {
            void server.sendLoggingMessage({ level: 'error', logger: 'index_code', data: `indexCodeDirectory failed for ${d}: ${String(err)}` }).catch((_e: unknown) => { /* fire-and-forget log */ });
            results.push({ directory: d, success: false, error: String(err) });
          }
        }
      }

      void server.sendLoggingMessage({ level: 'info', logger: 'index_code', data: { results } }).catch((_e: unknown) => { /* fire-and-forget log */ });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }
  );
}
