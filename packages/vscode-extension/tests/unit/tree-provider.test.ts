import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { McpServersTreeProvider } from '../../src/tree-provider';
import { makeRegistry } from './fake-servers';

describe('McpServersTreeProvider', () => {
  it('lists every server as a flat root and gives them no children', async () => {
    const { registry, servers } = await makeRegistry([['git', 'stopped'], ['files', 'stopped']]);
    const tree = new McpServersTreeProvider(registry);
    expect(tree.getChildren()).toEqual([servers['git']?.adapter, servers['files']?.adapter]);
    expect(tree.getChildren(servers['git']?.adapter)).toEqual([]);
  });

  describe('tree items', () => {
    const cases = [
      ['stopped', 'server.stopped', 'circle-outline', 'stopped'],
      ['starting', 'server.starting', 'loading~spin', 'starting...'],
      ['running', 'server.running', 'circle-filled', 'running on port 4000'],
      ['error', 'server.error', 'error', 'error'],
      ['unavailable', 'server.unavailable', 'warning', 'unavailable'],
    ] as const;

    it.each(cases)('%s: contextValue %s, icon %s, description "%s"', async (state, contextValue, icon, description) => {
      const { registry, servers } = await makeRegistry([['git', state, 4000]]);
      const item = new McpServersTreeProvider(registry).getTreeItem(servers['git']!.adapter);
      expect(item.label).toBe('GIT');
      expect(item.contextValue).toBe(contextValue);
      expect((item.iconPath as vscode.ThemeIcon).id).toBe(icon);
      expect(item.description).toBe(description);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(item.id).toBe('git');
    });

    it('colours the state icons', async () => {
      const { registry, servers } = await makeRegistry([['a', 'running'], ['b', 'error'], ['c', 'unavailable'], ['d', 'stopped']]);
      const tree = new McpServersTreeProvider(registry);
      const color = (id: string): string | undefined => ((tree.getTreeItem(servers[id]!.adapter).iconPath as vscode.ThemeIcon).color as vscode.ThemeColor | undefined)?.id;
      expect(color('a')).toBe('testing.iconPassed');
      expect(color('b')).toBe('testing.iconFailed');
      expect(color('c')).toBe('list.warningForeground');
      expect(color('d')).toBeUndefined();
    });

    it('the tooltip of a running server shows its URL', async () => {
      const { registry, servers } = await makeRegistry([['git', 'running', 4000]]);
      const tooltip = new McpServersTreeProvider(registry).getTreeItem(servers['git']!.adapter).tooltip;
      expect(tooltip).toContain('State: running');
      expect(tooltip).toContain('http://127.0.0.1:4000/mcp');
    });

    it('the tooltip of an errored or unavailable server shows the reason', async () => {
      const { registry, servers } = await makeRegistry([['a', 'error'], ['b', 'unavailable']]);
      const tree = new McpServersTreeProvider(registry);
      expect(tree.getTreeItem(servers['a']!.adapter).tooltip).toContain('Reason: A exploded');
      expect(tree.getTreeItem(servers['b']!.adapter).tooltip).toContain('Reason: B cannot run here');
    });

    it('never shows a token', async () => {
      const { registry, servers } = await makeRegistry([['git', 'running']]);
      const token = servers['git']!.activate.mock.calls[0]?.[0] as { authToken: string };
      const item = new McpServersTreeProvider(registry).getTreeItem(servers['git']!.adapter);
      expect(JSON.stringify(item)).not.toContain(token.authToken);
    });
  });

  it('refreshes the tree when a server changes state and stops after dispose()', async () => {
    const { registry, servers } = await makeRegistry([['git', 'stopped']]);
    const tree = new McpServersTreeProvider(registry);
    const listener = vi.fn();
    tree.onDidChangeTreeData(listener);
    await servers['git']!.adapter.start();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    tree.dispose();
    await servers['git']!.adapter.stop();
    expect(listener).not.toHaveBeenCalled();
  });
});
