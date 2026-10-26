import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const extensionDir = path.resolve(import.meta.dirname, '../..');
const bundle = inject('bundle');

/** `bin/vsce` entry of the extension's own @vscode/vsce devDependency. */
function vsceEntry(): string {
  const manifest = createRequire(path.join(extensionDir, 'package.json')).resolve('@vscode/vsce/package.json');
  const bin = (JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { vsce: string } }).bin.vsce;
  return path.join(path.dirname(manifest), bin);
}

const reason = bundle.nativeDir === undefined ? `native staging unavailable: ${bundle.nativeSkipReason ?? ''}` : undefined;

describe(`vsce ls --no-dependencies on a bundled and staged extension${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let packageDir: string;
  let listed: string[];
  let status: number | null;
  let stderr: string;

  beforeAll(() => {
    if (reason) return;
    packageDir = mkdtempSync(path.join(tmpdir(), 'vsix-contents-'));
    // What is on disk in a working copy: manifest, ignore file, README, sources and the build output ...
    for (const entry of ['package.json', '.vscodeignore', 'README.md', 'tsconfig.json', 'vitest.config.ts', 'src', 'tests', '__mocks__']) {
      if (existsSync(path.join(extensionDir, entry))) cpSync(path.join(extensionDir, entry), path.join(packageDir, entry), { recursive: true });
    }
    // (the test-only servers-entry bundle is not part of what the build produces)
    cpSync(path.join(bundle.root, 'dist'), path.join(packageDir, 'dist'), {
      recursive: true,
      filter: (source) => !path.basename(source).startsWith('servers-entry'),
    });
    // ... plus things that must never ship.
    mkdirSync(path.join(packageDir, 'scripts'));
    writeFileSync(path.join(packageDir, 'scripts', 'build.mjs'), '');
    mkdirSync(path.join(packageDir, 'coverage'));
    writeFileSync(path.join(packageDir, 'coverage', 'lcov.info'), '');
    mkdirSync(path.join(packageDir, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(path.join(packageDir, 'node_modules', 'left-pad', 'index.js'), '');
    writeFileSync(path.join(packageDir, '.env'), 'SECRET=1');
    writeFileSync(path.join(packageDir, 'tsconfig.tsbuildinfo'), '{}');
    writeFileSync(path.join(packageDir, 'old.vsix'), '');

    const run = spawnSync(process.execPath, [vsceEntry(), 'ls', '--no-dependencies'], { cwd: packageDir, encoding: 'utf8' });
    status = run.status;
    stderr = run.stderr;
    listed = run.stdout.split('\n').map((line) => line.trim().replaceAll('\\', '/')).filter(Boolean);
  }, 60_000);

  afterAll(() => {
    if (packageDir) rmSync(packageDir, { recursive: true, force: true });
  });

  it.skipIf(reason !== undefined)('succeeds', () => {
    expect(status, stderr).toBe(0);
  });

  it.skipIf(reason !== undefined)('ships the manifest, README and the bundle', () => {
    expect(listed).toEqual(expect.arrayContaining(['package.json', 'README.md', 'dist/extension.js']));
  });

  it.skipIf(reason !== undefined)('ships the staged natives, including tree-sitter and sqlite-vec files', () => {
    expect(listed).toEqual(
      expect.arrayContaining([
        'dist/native/index.js',
        'dist/native/node_modules/tree-sitter/package.json',
        'dist/native/node_modules/tree-sitter/index.js',
        'dist/native/node_modules/node-gyp-build/index.js',
        'dist/native/node_modules/sqlite-vec/index.cjs',
        'dist/native/node_modules/tree-sitter-typescript/package.json',
      ])
    );
    expect(listed.some((f) => /^dist\/native\/node_modules\/tree-sitter\/prebuilds\/[^/]+\/tree-sitter\.node$/.test(f))).toBe(true);
    expect(listed.some((f) => /^dist\/native\/node_modules\/sqlite-vec-[a-z0-9-]+\/vec0\.(so|dylib|dll)$/.test(f))).toBe(true);
  });

  it.skipIf(reason !== undefined)('leaves out sources, tests, scripts, mocks, configs, maps, env files and other node_modules', () => {
    const unwanted = listed.filter(
      (f) =>
        f.startsWith('src/') ||
        f.startsWith('tests/') ||
        f.startsWith('scripts/') ||
        f.startsWith('__mocks__/') ||
        f.startsWith('coverage/') ||
        /^tsconfig.*\.json$/.test(f) ||
        f.startsWith('vitest.config') ||
        f.endsWith('.map') ||
        f.endsWith('.vsix') ||
        f.endsWith('.tsbuildinfo') ||
        f === '.env' ||
        f === '.vscodeignore' ||
        (f.includes('node_modules/') && !f.startsWith('dist/native/node_modules/'))
    );
    expect(unwanted).toEqual([]);
  });

  it.skipIf(reason !== undefined)('stays small: only the host platform binaries are shipped', () => {
    const prebuilds = new Set(listed.map((f) => /prebuilds\/([^/]+)\//.exec(f)?.[1]).filter(Boolean));
    expect(prebuilds.size).toBe(1);
  });
});
