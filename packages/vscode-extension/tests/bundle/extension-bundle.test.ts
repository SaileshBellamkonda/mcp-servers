import { describe, expect, inject, it } from 'vitest';
import { failures, runSmoke } from './helpers';

describe('extension bundle in plain Node (stub vscode module)', () => {
  const bundle = inject('bundle');

  it('auto-starts the git server on the configured port (401 without a token), reports a taken port, and frees the port on deactivate()', async () => {
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
      'extension.deactivate',
      'extension.dispose',
    ]);
    const commands = (result.steps['extension.activate']?.detail as { commands: string[] }).commands;
    expect(commands).toEqual([
      'mcpServers.copyServerUrl',
      'mcpServers.restartServer',
      'mcpServers.startServer',
      'mcpServers.stopServer',
    ]);
  }, 60_000);
});
