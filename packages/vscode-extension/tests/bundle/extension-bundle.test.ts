import { describe, expect, inject, it } from 'vitest';
import { failures, runSmoke } from './helpers';

describe('extension bundle in plain Node (stub vscode module)', () => {
  const bundle = inject('bundle');

  it('exports activate/deactivate, registers the commands and starts and stops the git server', async () => {
    const { result } = await runSmoke({
      binary: process.execPath,
      args: ['--mode', 'extension', '--bundle', bundle.extensionJs],
    });
    expect(failures(result), failures(result)).toBe('');
    expect(Object.keys(result.steps)).toEqual([
      'extension.load',
      'extension.activate',
      'extension.start_stop',
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
