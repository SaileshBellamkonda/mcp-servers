import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import type { VectorDB } from '../../../src/vectordb/db.ts';
import type { Indexer } from '../../../src/indexer/indexer.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import { registerIndexMarkdown } from '../../../src/tools/index-markdown.ts';
import { registerSyncDocuments } from '../../../src/tools/sync-documents.ts';
import { PathGuard } from '../../../src/core/path-guard.ts';

interface ToolConfig {
  description: string;
  inputSchema: {
    '~standard': { jsonSchema: { input: (options: { target: string }) => { properties: Record<string, { description?: string }> } } };
  };
}

function captureConfigs(): { server: McpServer; configs: Map<string, ToolConfig> } {
  const configs = new Map<string, ToolConfig>();
  const server = {
    registerTool: (name: string, config: ToolConfig): void => {
      configs.set(name, config);
    },
  } as unknown as McpServer;
  return { server, configs };
}

describe('document tool descriptions', () => {
  it('index_markdown mentions MDX and its directory argument lists the extensions', () => {
    const { server, configs } = captureConfigs();
    registerIndexMarkdown(server, {} as Indexer, new SyncManager(), new PathGuard([process.cwd()]));
    const config = configs.get('index_markdown');
    expect(config?.description).toContain('MDX');
    const properties = config?.inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }).properties;
    expect(properties?.['directory']?.description).toContain('.mdx');
  });

  it('sync_documents mentions MDX', () => {
    const { server, configs } = captureConfigs();
    registerSyncDocuments(server, {} as VectorDB, {} as Indexer, [], new SyncManager(), new PathGuard([process.cwd()]));
    expect(configs.get('sync_documents')?.description).toContain('MDX');
  });
});
