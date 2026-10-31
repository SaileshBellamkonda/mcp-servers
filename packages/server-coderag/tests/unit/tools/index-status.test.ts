import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerIndexStatus } from '../../../src/tools/index-status.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

const DIMS = 4;

describe('get_index_status tool', () => {
  let server: McpServer;
  let db: VectorDB;
  let syncManager: SyncManager;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    db = VectorDB.open(':memory:', DIMS);
    syncManager = new SyncManager();

    registerIndexStatus(
      server,
      db,
      { model: 'test-model' },
      syncManager,
      '/path/to/db.sqlite',
    );
  });

  afterEach(() => {
    db.close();
  });

  it('should register get_index_status tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('get_index_status');
  });

  it('returns zero counts for empty db', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.document_count).toBe(0);
    expect(content.doc_count).toBe(0);
    expect(content.code_count).toBe(0);
  });

  it('returns null sync timestamps for fresh db', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.last_docs_sync_at).toBeNull();
    expect(content.last_code_sync_at).toBeNull();
  });

  it('returns the embedding model string passed in', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.embedding_model).toBe('test-model');
  });

  it('returns the dbPath passed in', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.db_path).toBe('/path/to/db.sqlite');
  });

  it('returns sync_in_progress: false when no sync is running', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.sync_in_progress).toBe(false);
  });

  it('returns sync_operation: null when no sync is running', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.sync_operation).toBeNull();
  });

  it('returns embedding_dim as a number or null', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    // For an in-memory db opened with DIMS=4, stored dimensions should be 4
    expect(typeof content.embedding_dim === 'number' || content.embedding_dim === null).toBe(true);
  });

  it('returns stored dimensions matching DIMS', async () => {
    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.embedding_dim).toBe(DIMS);
  });

  it('returns last_docs_sync_at as ISO string after setLastSyncAt', async () => {
    const syncDate = new Date('2024-01-01T00:00:00.000Z');
    db.setLastSyncAt('docs', syncDate);

    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.last_docs_sync_at).toBe(syncDate.toISOString());
  });

  it('returns last_code_sync_at as ISO string after setLastSyncAt for code', async () => {
    const syncDate = new Date('2024-06-15T12:00:00.000Z');
    db.setLastSyncAt('code', syncDate);

    const tool = registeredTool(server, 'get_index_status');
    const result = await tool.handler({});
    const content = JSON.parse(result.content[0].text);

    expect(content.last_code_sync_at).toBe(syncDate.toISOString());
  });
});
