import { createRequire } from 'node:module';
import { lstatSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without declarations
import * as stage from '../../../../scripts/stage-native.mjs';

const extensionDir = path.resolve(import.meta.dirname, '../..');

interface Target {
  name: string;
  platform: string;
  arch: string;
  vecPackage: string;
  loadable: string;
}
const api = stage as {
  TARGETS: Record<string, unknown>;
  hostTarget(): string;
  parseTarget(name: string): Target;
  parseArgs(argv: string[]): { target: string | undefined; extensionDir: string; out: string | undefined };
  selectPackageFiles(input: { manifest: { name?: string; main?: string }; files: string[]; target: Target }): string[];
  stageNative(options: { extensionDir: string; outDir?: string; target?: string }): {
    outDir: string;
    target: string;
    packages: { name: string; files: number; bytes: number }[];
  };
};

const GRAMMARS = [
  'bash', 'c', 'c-sharp', 'cpp', 'go', 'java', 'javascript', 'php', 'python', 'ruby', 'rust', 'typescript',
].map((g) => `tree-sitter-${g}`);

describe('stage-native: targets and arguments', () => {
  it('knows the five shipped vsce targets and rejects others', () => {
    expect(Object.keys(api.TARGETS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
    expect(api.parseTarget('win32-x64').vecPackage).toBe('sqlite-vec-windows-x64');
    expect(() => api.parseTarget('win32-arm64')).toThrow(/Unsupported target "win32-arm64"/);
    expect(() => api.parseTarget('alpine-x64')).toThrow(/Supported: /);
  });

  it('defaults to the host platform', () => {
    expect(api.hostTarget()).toBe(`${process.platform}-${process.arch}`);
  });

  it('parses --target, --extension-dir and --out and rejects anything else', () => {
    expect(api.parseArgs(['--target', 'linux-x64', '--out', '/x'])).toMatchObject({ target: 'linux-x64', out: '/x' });
    expect(api.parseArgs([]).target).toBeUndefined();
    expect(() => api.parseArgs(['--target'])).toThrow(/needs a value/);
    expect(() => api.parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('stage-native: selectPackageFiles', () => {
  const linux = api.parseTarget('linux-x64');
  const files = [
    'LICENSE',
    'README.md',
    'binding.gyp',
    'bindings/node/index.js',
    'bindings/node/binding.cc',
    'grammar.js',
    'index.js',
    'package.json',
    'prebuilds/darwin-arm64/x.node',
    'prebuilds/linux-arm64/x.node',
    'prebuilds/linux-x64/x.node',
    'prebuilds/win32-x64/x.node',
    'src/parser.c',
    'vec0.so',
    'vec0.dll',
  ];

  it('keeps the manifest, the entry, licences and only the target prebuild directory', () => {
    const selected = api.selectPackageFiles({ manifest: { main: 'index.js' }, files, target: linux });
    expect(selected).toEqual(['LICENSE', 'index.js', 'package.json', 'prebuilds/linux-x64/x.node', 'vec0.so']);
  });

  it('resolves a directory main (bindings/node) to its index.js', () => {
    const selected = api.selectPackageFiles({ manifest: { main: 'bindings/node' }, files, target: api.parseTarget('win32-x64') });
    expect(selected).toContain('bindings/node/index.js');
    expect(selected).toContain('prebuilds/win32-x64/x.node');
    expect(selected).toContain('vec0.dll');
    expect(selected).not.toContain('bindings/node/binding.cc');
    expect(selected.some((f) => f.includes('linux') || f.includes('darwin'))).toBe(false);
  });

  it('adds the sibling file node-gyp-build\'s entry requires', () => {
    const selected = api.selectPackageFiles({
      manifest: { name: 'node-gyp-build', main: 'index.js' },
      files: ['package.json', 'index.js', 'node-gyp-build.js', 'bin.js', 'build-test.js', 'optional.js', 'LICENSE'],
      target: linux,
    });
    expect(selected).toEqual(['LICENSE', 'index.js', 'node-gyp-build.js', 'package.json']);
  });

  it('accepts a "./"-prefixed main and falls back to build/Release for locally built addons', () => {
    const selected = api.selectPackageFiles({
      manifest: { main: './index.cjs' },
      files: ['package.json', 'index.cjs', 'index.mjs', 'build/Release/addon.node', 'build/Release/obj/x.o'],
      target: linux,
    });
    expect(selected).toEqual(['build/Release/addon.node', 'index.cjs', 'package.json']);
  });
});

describe('stage-native: stageNative on this machine', () => {
  const host = api.hostTarget();
  const supported = Object.hasOwn(api.TARGETS, host);
  let out: string;

  beforeAll(() => {
    out = mkdtempSync(path.join(tmpdir(), 'stage-native-'));
  });
  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it.skipIf(!supported)('stages real directories with only the host binaries, loadable from the staged tree', () => {
    const outDir = path.join(out, 'native');
    const result = api.stageNative({ extensionDir, outDir });
    expect(result.target).toBe(host);

    const modules = path.join(outDir, 'node_modules');
    const vecPackage = api.parseTarget(host).vecPackage;
    expect(readdirSync(modules).sort()).toEqual(
      [...GRAMMARS, 'node-gyp-build', 'sqlite-vec', vecPackage, 'tree-sitter'].sort()
    );
    expect(existsSync(path.join(outDir, 'index.js'))).toBe(true);

    // No symlinks anywhere, and no prebuild directory of another platform.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        expect(lstatSync(p).isSymbolicLink(), p).toBe(false);
        return e.isDirectory() ? walk(p) : [p];
      });
    const all = walk(outDir);
    for (const file of all) {
      const m = /prebuilds[\\/]([^\\/]+)/.exec(file);
      if (m) expect(m[1]).toBe(host);
    }
    expect(all.some((f) => /[\\/]src[\\/]/.test(f))).toBe(false);
    expect(result.packages.reduce((s, p) => s + p.bytes, 0)).toBeLessThan(30 * 1024 * 1024);

    // Bare specifiers resolve from the staged tree alone.
    const req = createRequire(path.join(outDir, 'index.js'));
    const Parser = req('tree-sitter') as new () => {
      setLanguage(l: unknown): void;
      parse(s: string): { rootNode: { type: string } };
    };
    const gypBuild = req(req.resolve('node-gyp-build', { paths: [path.join(modules, 'tree-sitter-python')] })) as (d: string) => unknown;
    const parser = new Parser();
    parser.setLanguage(gypBuild(path.join(modules, 'tree-sitter-python')));
    expect(parser.parse('def f():\n  pass\n').rootNode.type).toBe('module');

    const vec = req('sqlite-vec') as { getLoadablePath(): string };
    expect(vec.getLoadablePath().startsWith(modules)).toBe(true);
  });

  it('restages cleanly over an existing directory', () => {
    if (!supported) return;
    const outDir = path.join(out, 'again');
    api.stageNative({ extensionDir, outDir });
    api.stageNative({ extensionDir, outDir });
    expect(readdirSync(path.join(outDir, 'node_modules'))).toHaveLength(GRAMMARS.length + 4);
  });

  it.skipIf(!supported || host === 'win32-x64' || existsSyncVec('sqlite-vec-windows-x64'))(
    'fails with an actionable message when another target\'s sqlite-vec package is not installed',
    () => {
      expect(() => api.stageNative({ extensionDir, outDir: path.join(out, 'win'), target: 'win32-x64' })).toThrow(
        /sqlite-vec-windows-x64 is not installed.*supportedArchitectures/s
      );
      expect(existsSync(path.join(out, 'win'))).toBe(false);
    }
  );

  it('fails clearly when dependencies are not installed', () => {
    expect(() => api.stageNative({ extensionDir: out, outDir: path.join(out, 'x') })).toThrow(/pnpm install/);
  });
});

function existsSyncVec(name: string): boolean {
  try {
    const coderag = path.join(extensionDir, 'node_modules', '@mcp-servers', 'server-coderag', 'package.json');
    const vecDir = path.dirname(createRequire(coderag).resolve('sqlite-vec'));
    createRequire(path.join(vecDir, 'package.json')).resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}
