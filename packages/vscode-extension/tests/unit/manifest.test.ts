import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { McpServersTreeProvider } from '../../src/tree-provider';
import { gitDescriptor } from '../../src/servers/git-descriptor';
import { makeRegistry } from './fake-servers';

vi.mock('../../src/servers/module-loader', () => ({ loadServerModule: vi.fn() }));
import { activate, deactivate } from '../../src/extension';

interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}
interface Manifest {
  activationEvents: string[];
  contributes: {
    commands: { command: string; title: string; category?: string; icon?: string }[];
    menus: Record<string, MenuEntry[]>;
    views: Record<string, { id: string }[]>;
    configuration: { properties: Record<string, { default?: unknown; description?: string; type?: string }> };
  };
}
const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as Manifest;

/** Evaluates the subset of VS Code `when` syntax the manifest uses: `key`, `a == b`, `&&`, `||`, parentheses. */
function evalWhen(when: string, context: Record<string, unknown>): boolean {
  const js = when.replace(/([\w.]+)(?:\s*==\s*([\w.]+))?/g, (_m, key: string, value: string | undefined) =>
    value === undefined ? `(!!ctx[${JSON.stringify(key)}])` : `(ctx[${JSON.stringify(key)}] === ${JSON.stringify(value)})`
  );
  return new Function('ctx', `return ${js};`)(context) as boolean;
}

const commandIds = manifest.contributes.commands.map((c) => c.command);
const itemMenu = manifest.contributes.menus['view/item/context'] ?? [];
const paletteMenu = manifest.contributes.menus['commandPalette'] ?? [];
const STATES = ['stopped', 'starting', 'running', 'error', 'unavailable'] as const;

describe('package.json contributes', () => {
  it('declares exactly the commands the extension registers', () => {
    const ctx = { subscriptions: [] as { dispose(): void }[] };
    activate(ctx as never);
    const registered = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
    void deactivate();
    expect([...registered].sort()).toEqual([...commandIds].sort());
  });

  it('gives every command a title, the MCP Servers category and a codicon', () => {
    for (const command of manifest.contributes.commands) {
      expect(command.title, command.command).toBeTruthy();
      expect(command.category, command.command).toBe('MCP Servers');
      expect(command.icon, command.command).toMatch(/^\$\([a-z-]+\)$/);
    }
  });

  it('only references declared commands in menus', () => {
    for (const [menu, entries] of Object.entries(manifest.contributes.menus)) {
      for (const entry of entries) expect(commandIds, `${menu}: ${entry.command}`).toContain(entry.command);
    }
  });

  it('only matches tree items of the contributed view and contextValues the tree really produces', async () => {
    const viewIds = Object.values(manifest.contributes.views).flat().map((v) => v.id);
    const producible = new Set<string>();
    for (const state of STATES) {
      const { registry, servers } = await makeRegistry([['x', state]]);
      producible.add(new McpServersTreeProvider(registry).getTreeItem(servers['x']!.adapter).contextValue ?? '');
    }
    for (const entry of itemMenu) {
      for (const [, view] of (entry.when ?? '').matchAll(/\bview\s*==\s*([\w.]+)/g)) expect(viewIds).toContain(view);
      for (const [, value] of (entry.when ?? '').matchAll(/\bviewItem\s*==\s*([\w.]+)/g)) expect([...producible]).toContain(value);
    }
  });

  it('shows the right inline buttons and context-menu entries for every state', async () => {
    const expected: Record<(typeof STATES)[number], { inline: string[]; context: string[] }> = {
      stopped: { inline: ['startServer'], context: ['startServer'] },
      starting: { inline: [], context: [] },
      running: { inline: ['stopServer', 'restartServer'], context: ['stopServer', 'restartServer', 'copyServerUrl'] },
      error: { inline: ['startServer'], context: ['startServer'] },
      unavailable: { inline: [], context: [] },
    };
    for (const state of STATES) {
      const { registry, servers } = await makeRegistry([['x', state]]);
      const viewItem = new McpServersTreeProvider(registry).getTreeItem(servers['x']!.adapter).contextValue;
      const matching = itemMenu.filter((e) => evalWhen(e.when ?? 'true', { view: 'mcpServers', viewItem }));
      const names = (group: (g: string) => boolean): string[] =>
        matching.filter((e) => group(e.group ?? '')).map((e) => e.command.replace('mcpServers.', ''));
      expect(names((g) => g.startsWith('inline')).sort(), `${state} inline`).toEqual(expected[state].inline.sort());
      expect(names((g) => !g.startsWith('inline')).sort(), `${state} context`).toEqual(expected[state].context.sort());
    }
  });

  it('hides the palette entries whose context keys the extension never sets, and only uses keys it sets', async () => {
    const ctx = { subscriptions: [] as { dispose(): void }[] };
    activate(ctx as never);
    await Promise.resolve();
    const keys = new Set(
      vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'setContext').map((c) => String(c[1]))
    );
    await deactivate();
    expect(paletteMenu.length).toBeGreaterThan(0);
    for (const entry of paletteMenu) {
      const used = [...(entry.when ?? '').matchAll(/[\w.]+/g)].map((m) => m[0]);
      for (const key of used) expect([...keys], `${entry.command}: ${key}`).toContain(key);
    }
    for (const command of ['startServer', 'stopServer', 'restartServer', 'copyServerUrl']) {
      expect(paletteMenu.map((e) => e.command), command).toContain(`mcpServers.${command}`);
    }
  });

  it('declares the git settings with the descriptor defaults', () => {
    const props = manifest.contributes.configuration.properties;
    expect(props['mcpServers.git.port']).toMatchObject({ type: 'integer', default: gitDescriptor.defaultPort });
    expect(props['mcpServers.git.autoStart']).toMatchObject({ type: 'boolean', default: true });
    expect(props['mcpServers.git.autoStart']?.description).toMatch(/workspace folder/i);
  });

  it('still activates on startup so auto-start works', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });
});
