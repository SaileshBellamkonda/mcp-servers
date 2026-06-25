import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Indexer } from '../indexer/indexer.js';
import type { SyncManager } from '../indexer/sync-manager.js';
import { syncLockedResponse } from '../indexer/sync-manager.js';

const IndexMarkdownSchema = z.object({
  filepath: z.string().optional(),
  filepaths: z.string().optional(),
  directory: z.string().optional(),
  directories: z.string().optional(),
  exclude: z.string().optional().describe('Semicolon-separated glob patterns to exclude'),
  force: z.boolean().optional(),
});

export function registerIndexMarkdown(server: McpServer, indexer: Indexer, syncManager: SyncManager): void {
  server.registerTool(
    'index_markdown',
    {
      description: `Index markdown files for semantic search. Chunks by paragraph and generates embeddings.
Provide one or more of: filepath, filepaths, directory, directories.
Use exclude for semicolon-separated glob patterns (e.g. "drafts/**;**/*.draft.md").
Returns { locked: true } if a sync operation is in progress.`,
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Path to a single markdown file to index' },
          filepaths: { type: 'string', description: 'Comma-separated list of markdown files to index' },
          directory: { type: 'string', description: 'Directory to recursively index all markdown (.md) files' },
          directories: { type: 'string', description: 'Comma-separated list of directories to recursively index' },
          exclude: { type: 'string', description: 'Semicolon-separated glob patterns to exclude (e.g. "drafts/**;**/*.draft.md")' },
          force: { type: 'boolean', description: 'Force re-index even if file is unchanged (default: false)' },
        },
      }),
    },
    async (input: unknown) => {
      if (syncManager.inProgress) return syncLockedResponse(syncManager.status);

      const { filepath, filepaths, directory, directories, exclude, force } = IndexMarkdownSchema.parse(input);

      if (!filepath && !filepaths && !directory && !directories) {
        throw new Error('At least one of filepath, filepaths, directory, or directories is required');
      }

      const excludePatterns = exclude ? exclude.split(';').map((p) => p.trim()).filter(Boolean) : [];
      const results: { file?: string; directory?: string; success: boolean; error?: string; excluded?: boolean; indexed?: number; skipped?: number; failed?: number }[] = [];

      const indexSingleFile = async (f: string) => {
        if (indexer.isDocExcluded(f)) {
          results.push({ file: f, success: false, excluded: true, error: 'File is excluded by configured docs exclusion patterns' });
          return;
        }
        try {
          await indexer.indexFile(f);
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
          const r = await indexer.indexMarkdownDirectory(directory, force ?? false, excludePatterns);
          results.push({ directory, success: true, ...r });
        } catch (err) {
          void server.sendLoggingMessage({ level: 'error', logger: 'index_markdown', data: `indexMarkdownDirectory failed for ${directory}: ${String(err)}` }).catch((_e: unknown) => { /* fire-and-forget log */ });
          results.push({ directory, success: false, error: String(err) });
        }
      }

      if (directories) {
        for (const d of directories.split(',').map((x) => x.trim()).filter(Boolean)) {
          try {
            const r = await indexer.indexMarkdownDirectory(d, force ?? false, excludePatterns);
            results.push({ directory: d, success: true, ...r });
          } catch (err) {
            void server.sendLoggingMessage({ level: 'error', logger: 'index_markdown', data: `indexMarkdownDirectory failed for ${d}: ${String(err)}` }).catch((_e: unknown) => { /* fire-and-forget log */ });
            results.push({ directory: d, success: false, error: String(err) });
          }
        }
      }

      void server.sendLoggingMessage({ level: 'info', logger: 'index_markdown', data: { results } }).catch((_e: unknown) => { /* fire-and-forget log */ });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }
  );
}
