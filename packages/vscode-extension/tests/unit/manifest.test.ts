import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MCP_PROVIDER_ID } from '../../src/mcp-provider';
import { McpServersTreeProvider } from '../../src/tree-provider';
import { createCodeRagDescriptor } from '../../src/servers/coderag-descriptor';
import { gitDescriptor } from '../../src/servers/git-descriptor';
import { makeRegistry } from './fake-servers';
import { makeContext } from './test-context';

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
    configuration: { properties: Record<string, { default?: unknown; description?: string; type?: string; scope?: string; minimum?: number; maximum?: number }> };
    mcpServerDefinitionProviders?: { id: string; label: string }[];
  };
  engines: { vscode: string };
  capabilities?: Record<string, { supported?: unknown; description?: unknown }>;
}
const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as Manifest;

/** Evaluates the subset of VS Code `when` syntax the manifest uses: `key`, `a == b`, `&&`, `||`, parentheses. */
function evalWhen(when: string, context: Record<string, unknown>): boolean {
  const js = when.replace(/([\w.]+)(?:\s*==\s*([\w.]+))?/g, (_m, key: string, value: string | undefined) =>
    value === undefined ? `(!!ctx[${JSON.stringify(key)}])` : `(ctx[${JSON.stringify(key)}] === ${JSON.stringify(value)})`
  );
  return new Function('ctx', `return ${js};`)(context) as boolean;
}

const roots: string[] = [];
function newContext(): ReturnType<typeof makeContext> {
  const root = mkdtempSync(path.join(tmpdir(), 'manifest-test-'));
  roots.push(root);
  return makeContext(root);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const commandIds = manifest.contributes.commands.map((c) => c.command);
const itemMenu = manifest.contributes.menus['view/item/context'] ?? [];
const paletteMenu = manifest.contributes.menus['commandPalette'] ?? [];
const STATES = ['stopped', 'starting', 'running', 'error', 'unavailable'] as const;

describe('package.json contributes', () => {
  it('declares exactly the commands the extension registers', () => {
    const ctx = newContext();
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
    const ctx = newContext();
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

  describe('CodeRAG settings', () => {
    const props = manifest.contributes.configuration.properties;
    const coderag = createCodeRagDescriptor({ nativeModulesDir: '/x', storageDir: () => '/s', readApiKey: () => Promise.resolve(undefined), isRemote: () => false });
    const keys = Object.keys(props).filter((key) => key.startsWith('mcpServers.coderag.'));

    it('contributes autoStart (off: indexing costs), port and one setting per key the server reads', () => {
      expect(props['mcpServers.coderag.autoStart']).toMatchObject({ type: 'boolean', default: false });
      expect(props['mcpServers.coderag.autoStart']?.description).toMatch(/cost/i);
      expect(coderag.autoStartDefault).toBe(false);
      expect(props['mcpServers.coderag.port']).toMatchObject({ type: 'integer', default: coderag.defaultPort, minimum: 0, maximum: 65535 });
      expect(keys.map((key) => key.replace('mcpServers.coderag.', '')).sort()).toEqual(
        ['autoStart', 'port', ...(coderag.restartSettings ?? [])].sort()
      );
    });

    it('uses the key names loadConfigFromVsCode reads', () => {
      expect([...(coderag.restartSettings ?? [])].sort()).toEqual(
        ['allowedRoots', 'chunkSize', 'codeExclude', 'codeInclude', 'docsExclude', 'docsInclude', 'embeddingDim', 'embeddingModel', 'embeddingUrl', 'topK', 'useGitignore'].sort()
      );
    });

    it('scopes every setting that widens file access or redirects data to the machine (a repository settings file cannot set them)', () => {
      for (const key of ['allowedRoots', 'docsInclude', 'codeInclude', 'embeddingUrl']) {
        expect(props[`mcpServers.coderag.${key}`]?.scope, key).toBe('machine');
      }
    });

    it('keeps ports in the default (window) scope', () => {
      expect(props['mcpServers.git.port']?.scope).toBeUndefined();
      expect(props['mcpServers.coderag.port']?.scope).toBeUndefined();
    });

    it('has no setting for secrets: the API key lives in SecretStorage only', () => {
      expect(Object.keys(props).filter((key) => /api.?key|token|secret|password/i.test(key))).toEqual([]);
      expect(props['mcpServers.coderag.embeddingUrl']?.description).toMatch(/Set CodeRAG API Key/);
    });

    it('defaults empty glob lists so the server defaults apply', () => {
      for (const key of ['docsInclude', 'docsExclude', 'codeInclude', 'codeExclude', 'allowedRoots']) {
        expect(props[`mcpServers.coderag.${key}`], key).toMatchObject({ type: 'array', default: [] });
      }
    });
  });

  it('declares the MCP server definition provider the extension registers, on an engine that has the API', () => {
    expect(manifest.contributes.mcpServerDefinitionProviders).toEqual([{ id: MCP_PROVIDER_ID, label: expect.any(String) as string }]);
    expect(manifest.engines.vscode).toBe('^1.101.0');
  });

  it('offers the integration commands in the view title menu', () => {
    const titleMenu = manifest.contributes.menus['view/title'] ?? [];
    expect(titleMenu.map((entry) => entry.command)).toEqual(
      expect.arrayContaining(['mcpServers.addToClaudeCode', 'mcpServers.rotateToken', 'mcpServers.coderag.setApiKey', 'mcpServers.coderag.clearApiKey'])
    );
  });

  it('declares explicitly that untrusted and virtual workspaces are not supported, each with a reason for the user', () => {
    // A workspace folder's settings, git config and files steer what the servers read and run: no Restricted Mode.
    for (const capability of ['untrustedWorkspaces', 'virtualWorkspaces']) {
      const declared = manifest.capabilities?.[capability];
      expect(declared?.supported, capability).toBe(false);
      expect(declared?.description, capability).toEqual(expect.stringMatching(/\S{3,}/));
    }
    expect(String(manifest.capabilities?.['untrustedWorkspaces']?.description)).toMatch(/trust/i);
    expect(String(manifest.capabilities?.['virtualWorkspaces']?.description)).toMatch(/file system|local|virtual/i);
  });

  it('describes embeddingDim as the code behaves: an existing index keeps its stored dimension', () => {
    const description = manifest.contributes.configuration.properties['mcpServers.coderag.embeddingDim']?.description ?? '';
    expect(description).toMatch(/new index/i);
    expect(description).toMatch(/keeps? the dimension|stored dimension/i);
    expect(description).toMatch(/warning/i);
    expect(description).toMatch(/coderag\.db/);
    expect(description).not.toMatch(/vectors are reset|re-indexed automatically/i);
  });

  it('still activates on startup so auto-start works', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });
});
