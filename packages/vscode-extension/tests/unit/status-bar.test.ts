import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { StatusBarController } from '../../src/status-bar';
import { makeRegistry } from './fake-servers';

interface Item {
  text: string;
  tooltip: string;
  command: string | undefined;
  show: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function latestItem(): Item {
  const results = vi.mocked(vscode.window.createStatusBarItem).mock.results;
  return results[results.length - 1]?.value as Item;
}

describe('StatusBarController', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.createStatusBarItem).mockClear();
  });

  it('shows idle when nothing runs and is visible and clickable', async () => {
    const { registry } = await makeRegistry([['git', 'stopped']]);
    const controller = new StatusBarController(registry);
    const item = latestItem();
    expect(item.text).toBe('$(server) MCP: idle');
    expect(item.show).toHaveBeenCalled();
    expect(item.command).toBe('mcpServers.focus');
    controller.dispose();
  });

  it('counts the running servers and lists every server in the tooltip', async () => {
    const { registry } = await makeRegistry([
      ['git', 'running', 3000],
      ['files', 'running', 3200],
      ['coderag', 'unavailable'],
      ['broken', 'error'],
      ['idle', 'stopped'],
    ]);
    new StatusBarController(registry);
    const item = latestItem();
    expect(item.text).toBe('$(server) MCP: 2 running $(warning)');
    expect(item.tooltip).toContain('GIT: running at http://127.0.0.1:3000/mcp');
    expect(item.tooltip).toContain('CODERAG' + ': unavailable (CODERAG cannot run here)');
    expect(item.tooltip).toContain('BROKEN: error (BROKEN exploded)');
    expect(item.tooltip).toContain('IDLE: stopped');
  });

  it('updates when a server changes state', async () => {
    const { registry, servers } = await makeRegistry([['git', 'stopped']]);
    new StatusBarController(registry);
    await servers['git']!.adapter.start();
    expect(latestItem().text).toBe('$(server) MCP: 1 running');
    await servers['git']!.adapter.stop();
    expect(latestItem().text).toBe('$(server) MCP: idle');
  });

  it('dispose() disposes the item and stops updating', async () => {
    const { registry, servers } = await makeRegistry([['git', 'stopped']]);
    const controller = new StatusBarController(registry);
    const item = latestItem();
    controller.dispose();
    expect(item.dispose).toHaveBeenCalled();
    await servers['git']!.adapter.start();
    expect(item.text).toBe('$(server) MCP: idle');
  });
});
