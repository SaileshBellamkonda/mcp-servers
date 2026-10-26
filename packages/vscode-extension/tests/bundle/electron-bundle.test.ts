import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { failures, runSmoke, type SmokeResult } from './helpers';

/**
 * Runs the bundle under the Node of real VS Code builds (`ELECTRON_RUN_AS_NODE=1`). The builds are the ones
 * `@vscode/test-electron` downloads: `<VSCODE_TEST_BINARIES>/vscode-<platform>-<version>/<binary>`. Without the
 * variable (or without a build) the tests are skipped, with the reason in their name.
 *
 *   VSCODE_TEST_BINARIES=/path/to/cache pnpm --filter mcp-servers test
 */
const binariesDir = process.env['VSCODE_TEST_BINARIES'];
const platform = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;

function vscodeBinary(version: string): string | undefined {
  if (!binariesDir) return undefined;
  const root = path.join(binariesDir, `vscode-${platform}-${version}`);
  const candidates =
    process.platform === 'win32'
      ? [path.join(root, 'Code.exe')]
      : process.platform === 'darwin'
        ? [path.join(root, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron')]
        : [path.join(root, 'code')];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Environment for the child: no inherited NODE_PATH, so only the bundle's own files can satisfy a require. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'NODE_PATH' && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  return env;
}

const bundle = inject('bundle');
const gitSteps = ['git.setup', 'git.start', 'git.auth', 'git.status', 'git.close'];

function skipReason(version: string): string | undefined {
  if (!binariesDir) return 'VSCODE_TEST_BINARIES is not set';
  if (!vscodeBinary(version)) return `no VS Code ${version} build in ${binariesDir}`;
  return undefined;
}

async function run(version: string, args: string[]): Promise<SmokeResult> {
  const binary = vscodeBinary(version);
  if (!binary) throw new Error(`VS Code ${version} not found`);
  const { result } = await runSmoke({ binary, args, electron: true, env: cleanEnv(), timeoutMs: 120_000 });
  return result;
}

function describeRun(version: string): void {
  const reason = skipReason(version);
  describe(`bundle under ELECTRON_RUN_AS_NODE with VS Code ${version}${reason ? ` (skipped: ${reason})` : ''}`, () => {
    it.skipIf(reason !== undefined)('the extension activates with a stub vscode module and starts/stops git', async () => {
      const result = await run(version, ['--mode', 'extension', '--bundle', bundle.extensionJs]);
      expect(result.runtime.electron, 'must really run inside Electron').not.toBeNull();
      expect(failures(result), failures(result)).toBe('');
    }, 150_000);

    it.skipIf(reason !== undefined || bundle.nativeDir === undefined)('the git server works from the bundle', async () => {
      const result = await run(version, ['--mode', 'servers', '--entry', bundle.serversEntry, '--native', bundle.nativeDir ?? '']);
      expect(result.runtime.electron).not.toBeNull();
      for (const name of gitSteps) expect(result.steps[name], `${name}: ${failures(result)}`).toMatchObject({ ok: true });
      // Recorded for the compatibility matrix.
      console.log(`[VS Code ${version}] node ${result.runtime.node}, electron ${String(result.runtime.electron)}, sqlite ${String(result.runtime.sqlite)}: coderag probe ${JSON.stringify(result.probe)}`);
    }, 150_000);

    if (version === '1.101.2') {
      it.skipIf(reason !== undefined || bundle.nativeDir === undefined)(
        'coderag reports the missing FTS5 through the probe (Electron 35 lacks it) instead of silently misbehaving',
        async () => {
          const result = await run(version, ['--mode', 'servers', '--entry', bundle.serversEntry, '--native', bundle.nativeDir ?? '']);
          expect(result.probe).toMatchObject({ ok: false, needs: 'fts5' });
          expect(result.steps['coderag.start']).toMatchObject({ ok: false });
        },
        150_000
      );
    } else {
      it.skipIf(reason !== undefined || bundle.nativeDir === undefined)('coderag starts, indexes with tree-sitter and searches with sqlite-vec', async () => {
        const result = await run(version, ['--mode', 'servers', '--entry', bundle.serversEntry, '--native', bundle.nativeDir ?? '']);
        expect(failures(result), failures(result)).toBe('');
        expect(result.probe).toEqual({ ok: true });
      }, 150_000);
    }
  });
}

describeRun('1.101.2');
describeRun('1.143.1');
