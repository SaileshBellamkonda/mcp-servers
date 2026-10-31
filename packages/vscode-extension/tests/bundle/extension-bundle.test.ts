import { describe, expect, inject, it } from 'vitest';
import { failures, runSmoke } from './helpers';

describe('extension bundle in plain Node (stub vscode module)', () => {
  const bundle = inject('bundle');

  it.skipIf(bundle.nativeDir === undefined)(
    `runs git and CodeRAG end to end: tokens, helper, MCP provider, .mcp.json, rotation, deactivate${bundle.nativeSkipReason ? ` (skipped: ${bundle.nativeSkipReason})` : ''}`,
    async () => {
      const { result } = await runSmoke({
        binary: process.execPath,
        args: ['--mode', 'extension', '--bundle', bundle.extensionJs],
      });
      expect(failures(result), failures(result)).toBe('');
      expect(Object.keys(result.steps)).toEqual([
        'extension.load',
        'extension.activate',
        'extension.autostart',
        'extension.copy_url',
        'extension.port_in_use',
        'extension.coderag_start',
        'extension.token',
        'extension.git_token',
        'extension.coderag_works',
        'extension.mcp_provider',
        'extension.add_to_claude_code',
        'extension.rotate',
        'extension.deactivate',
        'extension.dispose',
      ]);
      expect(result.steps['extension.coderag_start']?.detail).toMatchObject({ contextValue: 'server.running' });
      const detail = result.steps['extension.activate']?.detail as { commands: string[] } | undefined;
      const commands = detail?.commands;
      expect(commands).toEqual([
        'mcpServers.addToClaudeCode',
        'mcpServers.coderag.clearApiKey',
        'mcpServers.coderag.setApiKey',
        'mcpServers.copyServerUrl',
        'mcpServers.restartServer',
        'mcpServers.rotateToken',
        'mcpServers.startServer',
        'mcpServers.stopServer',
      ]);
    },
    120_000
  );

  it('keeps git working and reports CodeRAG as unavailable (not an error) when the native modules are not there', async () => {
    // The bundle's native directory is simply absent: copy only the JS bundle next to an empty dist.
    const { mkdtempSync, copyFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'ext-nonative-'));
    try {
      copyFileSync(bundle.extensionJs, path.join(dir, 'extension.js'));
      copyFileSync(bundle.helperJs, path.join(dir, 'mcp-headers.js'));
      const { result } = await runSmoke({
        binary: process.execPath,
        args: ['--mode', 'extension', '--bundle', path.join(dir, 'extension.js')],
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_PATH') as [string, string][]),
      });
      expect(failures(result), failures(result)).toBe('');
      const start = result.steps['extension.coderag_start']?.detail as { contextValue: string; description: string };
      expect(start.contextValue).toBe('server.unavailable');
      expect(start.description).toMatch(/sqlite-vec|tree-sitter/i);
      expect(result.steps['extension.coderag_works']).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
