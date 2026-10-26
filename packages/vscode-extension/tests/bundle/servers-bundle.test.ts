import { describe, expect, inject, it } from 'vitest';
import { failures, runSmoke } from './helpers';

const bundle = inject('bundle');

describe('bundled embedded servers in plain Node', () => {
  it.skipIf(bundle.nativeDir === undefined)(
    `git and coderag start, authenticate and work from the staged native directory${bundle.nativeSkipReason ? ` (skipped: ${bundle.nativeSkipReason})` : ''}`,
    async () => {
      const { result } = await runSmoke({
        binary: process.execPath,
        args: ['--mode', 'servers', '--entry', bundle.serversEntry, '--native', bundle.nativeDir ?? ''],
      });
      expect(failures(result), failures(result)).toBe('');
      expect(Object.keys(result.steps)).toEqual([
        'git.setup',
        'git.start',
        'git.auth',
        'git.status',
        'git.close',
        'coderag.probe',
        'coderag.start',
        'coderag.auth',
        'coderag.status',
        'coderag.index_code',
        'coderag.search',
        'coderag.close',
      ]);
      expect(result.probe).toEqual({ ok: true });
    },
    120_000
  );
});
