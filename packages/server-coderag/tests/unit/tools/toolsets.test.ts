import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { initializeSession, postJsonRpc, startTestServer, type TestServer } from '@mcp-servers/http-host/testing';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { SyncManager } from '../../../src/indexer/sync-manager.js';
import { createCodeRagServer } from '../../../src/server/coderag-server.js';
import type { Toolset } from '../../../src/core/toolset.js';

const TOKEN = `toolset-token-${'t'.repeat(32)}`;

let db: VectorDB;
let indexer: Indexer;
let host: TestServer | undefined;

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
  indexer = new Indexer(db, new Embedder({ url: 'http://127.0.0.1:9/v1', model: 'm', batchSize: 1 }), 500);
});

afterEach(async () => {
  await host?.close();
  host = undefined;
  indexer.close();
  db.close();
});

function build(toolset?: Toolset): McpServer {
  const server = new McpServer({ name: 'toolset-test', version: '1.0.0' }, { capabilities: { tools: {} } });
  createCodeRagServer(server, db, new Embedder({ url: 'http://127.0.0.1:9/v1', model: 'm', batchSize: 1 }), indexer, 5, [], new SyncManager(), undefined, undefined, undefined, undefined, toolset === undefined ? {} : { toolset });
  return server;
}

function toolNames(server: McpServer): string[] {
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
}

/** The `tools/list` result as a client receives it; its size is what every session pays for the tool definitions. */
async function listedTools(toolset?: Toolset): Promise<{ names: string[]; tokens: number }> {
  host = await startTestServer({ createServer: () => build(toolset), token: TOKEN });
  const session = await initializeSession(host.url, { token: TOKEN });
  const reply = await postJsonRpc(
    host.url,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': session.sessionId ?? '' } },
  );
  const result = (reply.message as { result: { tools: { name: string }[] } }).result;
  return { names: result.tools.map((t) => t.name).sort(), tokens: Math.ceil(JSON.stringify(result).length / 4) };
}

describe('createCodeRagServer toolsets', () => {
  it('registers the standard toolset by default: search, index status and the sync tool', () => {
    expect(toolNames(build())).toEqual(['get_index_status', 'search', 'sync_documents']);
    expect(toolNames(build('standard'))).toEqual(['get_index_status', 'search', 'sync_documents']);
  });

  it('registers only search for the search toolset', () => {
    expect(toolNames(build('search'))).toEqual(['search']);
  });

  it('registers all 11 tools for the all toolset', () => {
    expect(toolNames(build('all'))).toEqual([
      'add_frontmatter', 'delete_document', 'get_index_status', 'index_code', 'index_markdown', 'list_documents',
      'reindex_document', 'search', 'search_relations', 'sync_documents', 'update_frontmatter',
    ]);
  });

  it('lists fewer tool-definition tokens the smaller the toolset', async () => {
    const search = await listedTools('search');
    await host?.close();
    const standard = await listedTools('standard');
    await host?.close();
    const all = await listedTools('all');
    expect(search.names).toEqual(['search']);
    expect(standard.names).toEqual(['get_index_status', 'search', 'sync_documents']);
    expect(all.names).toHaveLength(11);
    expect(search.tokens).toBeLessThan(standard.tokens);
    expect(standard.tokens).toBeLessThan(all.tokens);
    // Budget for the default surface (measured: see the README); a regression here costs every session.
    expect(standard.tokens).toBeLessThan(1100);
    process.stderr.write(`TOOL-DEFINITION TOKENS (chars/4): search=${String(search.tokens)} standard=${String(standard.tokens)} all=${String(all.tokens)}\n`);
  });
});
