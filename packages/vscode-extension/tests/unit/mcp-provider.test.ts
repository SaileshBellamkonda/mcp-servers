import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MCP_PROVIDER_ID, McpServersDefinitionProvider, registerMcpProvider } from '../../src/mcp-provider';
import type { TokenProvider } from '../../src/core/token-provider';
import { makeRegistry } from './fake-servers';

const TOKEN = 'p'.repeat(64);
const test = (vscode as unknown as { __test: { mcpProviders(): ReadonlyMap<string, vscode.McpServerDefinitionProvider>; reset(): void } }).__test;

function tokens(): TokenProvider & { getToken: ReturnType<typeof vi.fn> } {
  return { getToken: vi.fn(() => Promise.resolve(TOKEN)) };
}

async function setup(specs: Parameters<typeof makeRegistry>[0]) {
  const made = await makeRegistry(specs);
  const tokenProvider = tokens();
  const provider = new McpServersDefinitionProvider(made.registry, tokenProvider, () => 'abcdef0123456789');
  const definitions = () => (provider.provideMcpServerDefinitions({} as never) as vscode.McpHttpServerDefinition[]);
  return { ...made, tokenProvider, provider, definitions };
}

describe('McpServersDefinitionProvider', () => {
  describe('provideMcpServerDefinitions', () => {
    it('lists every available server, with a label per server and its URL, and no credentials', async () => {
      const { definitions } = await setup([['git', 'running', 3000], ['coderag', 'stopped', 3100]]);
      const list = definitions();
      expect(list.map((d) => d.label)).toEqual(['MCP Servers: GIT', 'MCP Servers: CODERAG']);
      expect(list.map((d) => d.uri.toString())).toEqual(['http://127.0.0.1:3000/mcp', 'http://127.0.0.1:3100/mcp']);
      for (const definition of list) {
        expect(definition.headers).toEqual({});
        expect(JSON.stringify(definition)).not.toContain(TOKEN);
      }
    });

    it('lists stopped, starting and failed servers so they can be toggled in the MCP UI', async () => {
      const { definitions } = await setup([['a', 'stopped', 3001], ['b', 'starting', 3002], ['c', 'error', 3003]]);
      expect(definitions()).toHaveLength(3);
    });

    it('omits unavailable servers', async () => {
      const { definitions } = await setup([['git', 'running', 3000], ['coderag', 'unavailable', 3100]]);
      expect(definitions().map((d) => d.label)).toEqual(['MCP Servers: GIT']);
    });

    it('omits a stopped server whose port is 0: its URL is unknown until it runs', async () => {
      const { definitions } = await setup([['git', 'stopped', 0]]);
      expect(definitions()).toEqual([]);
    });
  });

  describe('resolveMcpServerDefinition', () => {
    it('starts a stopped server and returns its definition with exactly the stored token as a Bearer header', async () => {
      const { provider, definitions, servers, tokenProvider } = await setup([['git', 'stopped', 3000]]);
      const [definition] = definitions();
      const resolved = (await provider.resolveMcpServerDefinition(definition as vscode.McpHttpServerDefinition, {} as never)) as vscode.McpHttpServerDefinition;
      expect(servers['git']?.adapter.getInfo().state).toBe('running');
      expect(servers['git']?.activate).toHaveBeenCalledOnce();
      expect(resolved.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
      expect(resolved.uri.toString()).toBe('http://127.0.0.1:3000/mcp');
      expect(resolved.label).toBe('MCP Servers: GIT');
      expect(tokenProvider.getToken).toHaveBeenCalledWith('git', 'abcdef0123456789');
    });

    it('does not restart a running server', async () => {
      const { provider, definitions, servers } = await setup([['git', 'running', 3000]]);
      await provider.resolveMcpServerDefinition(definitions()[0] as vscode.McpHttpServerDefinition, {} as never);
      expect(servers['git']?.activate).toHaveBeenCalledOnce();
    });

    it('resolves with the port the server really listens on', async () => {
      const { provider } = await setup([['git', 'running', 3555]]);
      const stale = new vscode.McpHttpServerDefinition('MCP Servers: GIT', vscode.Uri.parse('http://127.0.0.1:3000/mcp'));
      const resolved = (await provider.resolveMcpServerDefinition(stale, {} as never)) as vscode.McpHttpServerDefinition;
      expect(resolved.uri.toString()).toBe('http://127.0.0.1:3555/mcp');
    });

    it('throws the unavailable reason for a server that cannot run here', async () => {
      const { provider } = await setup([['coderag', 'unavailable', 3100]]);
      const stale = new vscode.McpHttpServerDefinition('MCP Servers: CODERAG', vscode.Uri.parse('http://127.0.0.1:3100/mcp'));
      await expect(provider.resolveMcpServerDefinition(stale, {} as never)).rejects.toThrow('CODERAG cannot run here');
    });

    it('throws the start error (so the MCP UI shows it) and never leaks the token', async () => {
      const { provider, definitions } = await setup([['git', 'error', 3000]]);
      const attempt = provider.resolveMcpServerDefinition(definitions()[0] as vscode.McpHttpServerDefinition, {} as never);
      await expect(attempt).rejects.toThrow('GIT exploded');
      await attempt.catch((error: Error) => {
        expect(error.message).not.toContain(TOKEN);
      });
    });

    it('throws for a definition it does not know', async () => {
      const { provider } = await setup([['git', 'running', 3000]]);
      const alien = new vscode.McpHttpServerDefinition('Somebody else', vscode.Uri.parse('http://127.0.0.1:9/mcp'));
      await expect(provider.resolveMcpServerDefinition(alien, {} as never)).rejects.toThrow(/unknown/i);
    });

    it('turns a server that reports unavailable while starting into an error with its reason', async () => {
      const { provider, definitions, servers } = await setup([['git', 'stopped', 3000]]);
      const unavailable = servers['git'];
      if (!unavailable) throw new Error('no server');
      (unavailable.descriptor as { isAvailable: unknown }).isAvailable = () => ({ available: false, reason: 'Needs VS Code 1.103 or newer' });
      await expect(provider.resolveMcpServerDefinition(definitions()[0] as vscode.McpHttpServerDefinition, {} as never)).rejects.toThrow('Needs VS Code 1.103 or newer');
    });
  });

  describe('onDidChangeMcpServerDefinitions', () => {
    it('fires when the set of listed definitions changes (a port-0 server starts and becomes listed)', async () => {
      const { provider, servers } = await setup([['git', 'stopped', 0]]);
      const listener = vi.fn();
      provider.onDidChangeMcpServerDefinitions(listener);
      await servers['git']?.adapter.start();
      expect(listener).toHaveBeenCalled();
    });

    it('does not fire for state changes that leave the definitions identical', async () => {
      const { provider, definitions, servers } = await setup([['git', 'running', 3000]]);
      definitions();
      const listener = vi.fn();
      provider.onDidChangeMcpServerDefinitions(listener);
      await servers['git']?.adapter.stop();
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifyChanged() always fires, and bumps the version of every definition so clients re-resolve (token rotation)', async () => {
      const { provider, definitions } = await setup([['git', 'running', 3000]]);
      const before = definitions()[0]?.version;
      const listener = vi.fn();
      provider.onDidChangeMcpServerDefinitions(listener);
      provider.notifyChanged({ newToken: true });
      expect(listener).toHaveBeenCalledOnce();
      expect(definitions()[0]?.version).not.toBe(before);
    });

    it('stops notifying after dispose', async () => {
      const { provider } = await setup([['git', 'running', 3000]]);
      const listener = vi.fn();
      provider.onDidChangeMcpServerDefinitions(listener);
      provider.dispose();
      provider.notifyChanged();
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe('registerMcpProvider', () => {
  beforeEach(() => {
    test.reset();
  });

  it('registers the provider under the id declared in package.json', async () => {
    const { registry } = await makeRegistry([['git', 'running', 3000]]);
    const registered = registerMcpProvider(registry, tokens(), () => 'abcdef0123456789');
    expect(MCP_PROVIDER_ID).toBe('mcpServers.servers');
    expect(vscode.lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith('mcpServers.servers', registered?.provider);
    expect(test.mcpProviders().has('mcpServers.servers')).toBe(true);
    registered?.dispose();
    expect(test.mcpProviders().has('mcpServers.servers')).toBe(false);
  });

  it('skips registration, without throwing, on hosts that lack the MCP API', async () => {
    const { registry } = await makeRegistry([['git', 'running', 3000]]);
    const lm = vscode.lm as { registerMcpServerDefinitionProvider?: unknown };
    const original = lm.registerMcpServerDefinitionProvider;
    lm.registerMcpServerDefinitionProvider = undefined;
    try {
      expect(registerMcpProvider(registry, tokens(), () => 'abcdef0123456789')).toBeUndefined();
    } finally {
      lm.registerMcpServerDefinitionProvider = original;
    }
  });
});
