import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { McpServersTreeProvider } from '../../src/tree-provider';
import type { ServerRegistry } from '../../src/server-registry';
import type { IManagedServer, ServerStatus } from '../../src/managed-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMockRegistry(servers: IManagedServer[] = []): {
  registry: ServerRegistry;
  triggerChange: () => void;
} {
  const listeners: (() => void)[] = [];
  const registry = {
    servers,
    onDidChange: (listener: () => void): { dispose: () => void } => {
      listeners.push(listener);
      return { dispose: vi.fn() };
    },
    register: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ServerRegistry;

  return {
    registry,
    triggerChange: () => listeners.forEach(l => l()),
  };
}

function makeMockServer(
  overrides: Partial<IManagedServer> = {}
): IManagedServer {
  return {
    id: 'test',
    displayName: 'Test Server',
    status: 'stopped' as ServerStatus,
    port: undefined,
    onDidChangeStatus: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  } as unknown as IManagedServer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('McpServersTreeProvider', () => {
  // ---- getChildren --------------------------------------------------------
  describe('getChildren()', () => {
    it('returns all servers from the registry', () => {
      const servers = [
        makeMockServer({ id: 'git' }),
        makeMockServer({ id: 'other' }),
      ];
      const { registry } = makeMockRegistry(servers);
      const provider = new McpServersTreeProvider(registry);
      expect(provider.getChildren()).toEqual(servers);
    });

    it('returns empty array when no servers registered', () => {
      const { registry } = makeMockRegistry([]);
      const provider = new McpServersTreeProvider(registry);
      expect(provider.getChildren()).toEqual([]);
    });
  });

  // ---- getTreeItem — icons ------------------------------------------------
  describe('getTreeItem() — icon', () => {
    it.each([
      ['stopped', 'circle-outline'],
      ['starting', 'loading~spin'],
      ['running', 'circle-filled'],
      ['error', 'error'],
    ] as [ServerStatus, string][])(
      'sets icon "%s" for status "%s"',
      (status, expectedIcon) => {
        const { registry } = makeMockRegistry();
        const provider = new McpServersTreeProvider(registry);
        const server = makeMockServer({ status });
        const item = provider.getTreeItem(server);
        expect((item.iconPath as vscode.ThemeIcon).id).toBe(expectedIcon);
      }
    );
  });

  // ---- getTreeItem — label ------------------------------------------------
  describe('getTreeItem() — label', () => {
    it('includes displayName in the label', () => {
      const { registry } = makeMockRegistry();
      const provider = new McpServersTreeProvider(registry);
      const server = makeMockServer({
        displayName: 'Git MCP Server',
        status: 'stopped',
      });
      const item = provider.getTreeItem(server);
      expect(item.label as string).toContain('Git MCP Server');
    });

    it('includes status in the label', () => {
      const { registry } = makeMockRegistry();
      const provider = new McpServersTreeProvider(registry);
      const server = makeMockServer({ status: 'running' });
      const item = provider.getTreeItem(server);
      expect(item.label as string).toContain('running');
    });

    it('includes port in the label when status is running', () => {
      const { registry } = makeMockRegistry();
      const provider = new McpServersTreeProvider(registry);
      const server = makeMockServer({ status: 'running', port: 3000 });
      const item = provider.getTreeItem(server);
      expect(item.label as string).toContain('3000');
    });

    it('does not include port in label when status is stopped', () => {
      const { registry } = makeMockRegistry();
      const provider = new McpServersTreeProvider(registry);
      const server = makeMockServer({ status: 'stopped', port: undefined });
      const item = provider.getTreeItem(server);
      expect(item.label as string).not.toMatch(/port/i);
    });
  });

  // ---- getTreeItem — contextValue -----------------------------------------
  describe('getTreeItem() — contextValue', () => {
    it.each([
      ['stopped'],
      ['starting'],
      ['running'],
      ['error'],
    ] as [ServerStatus][])(
      'sets contextValue to status "%s"',
      (status) => {
        const { registry } = makeMockRegistry();
        const provider = new McpServersTreeProvider(registry);
        const server = makeMockServer({ status });
        const item = provider.getTreeItem(server);
        expect(item.contextValue).toBe(status);
      }
    );
  });

  // ---- onDidChange integration --------------------------------------------
  describe('onDidChangeTreeData', () => {
    it('fires when registry fires onDidChange', () => {
      const { registry, triggerChange } = makeMockRegistry();
      const provider = new McpServersTreeProvider(registry);
      const listener = vi.fn();
      provider.onDidChangeTreeData!(listener);
      triggerChange();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('fires multiple times for multiple registry change events', () => {
      const { registry, triggerChange } = makeMockRegistry();
      const provider = new McpServersTreeProvider(registry);
      const listener = vi.fn();
      provider.onDidChangeTreeData!(listener);
      triggerChange();
      triggerChange();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});
