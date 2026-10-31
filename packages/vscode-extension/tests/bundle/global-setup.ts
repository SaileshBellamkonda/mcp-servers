import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type UserConfig } from 'tsdown';
import type { TestProject } from 'vitest/node';
// @ts-expect-error -- plain ESM script without declarations
import { stageNative, hostTarget, TARGETS } from '../../../../scripts/stage-native.mjs';
import { importedSpecifiers } from './bundle-imports';

/** What the bundle tests share: one bundle + staged natives built once into a temporary directory. */
export interface BundleFixture {
  /** Directory holding `dist/` (a copy of what `pnpm run build` and `stage:native` produce). */
  root: string;
  /** `<root>/dist/extension.js` */
  extensionJs: string;
  /** `<root>/dist/mcp-headers.js`: the dependency-free headersHelper script. */
  helperJs: string;
  /** `<root>/dist/servers-entry.js`: the same bundle options, exporting the embedded server entry points. */
  serversEntry: string;
  /** Every module the extension bundles load at run time (should be `vscode` and built-ins). */
  externalImports: string[];
  /** `<root>/dist/native`, or undefined when staging was not possible (see `nativeSkipReason`). */
  nativeDir: string | undefined;
  nativeSkipReason: string | undefined;
}

declare module 'vitest' {
  export interface ProvidedContext {
    bundle: BundleFixture;
  }
}

const extensionDir = path.resolve(import.meta.dirname, '../..');
const coderagSource = path.resolve(extensionDir, '../server-coderag/src');

/** Test-only second entry point: the embedded server activators, so plain Node can drive the bundled servers. */
const SERVERS_ENTRY = `
export { activateGitServer } from '@mcp-servers/server-git/embedded';
export { activateCodeRagServer } from '@mcp-servers/server-coderag/embedded';
export { probeSqliteSupport } from ${JSON.stringify(path.join(coderagSource, 'vectordb', 'sqlite-probe.ts'))};
`;

export default async function setup(project: TestProject): Promise<() => void> {
  const root = mkdtempSync(path.join(tmpdir(), 'ext-bundle-'));
  const dist = path.join(root, 'dist');
  mkdirSync(dist, { recursive: true });

  // The package's own `bundle` script, redirected to a temporary directory.
  execFileSync('pnpm', ['run', 'bundle', '--out-dir', dist], { cwd: extensionDir, stdio: 'pipe' });
  const externalImports = [
    ...new Set(['extension.js', 'mcp-headers.js'].flatMap((name) => importedSpecifiers(readFileSync(path.join(dist, name), 'utf8')))),
  ].sort();

  // Second bundle with the extension's own build settings, from a test-only entry. The entry lives inside the
  // extension directory so its bare specifiers resolve from the extension's node_modules.
  const configs = JSON.parse(readFileSync(path.join(extensionDir, 'tsdown.config.json'), 'utf8')) as UserConfig[];
  const extensionBuild = configs.find((config) => typeof config.entry === 'object' && !Array.isArray(config.entry) && 'extension' in config.entry);
  if (extensionBuild === undefined) throw new Error('tsdown.config.json has no "extension" build');
  const entryDir = path.join(extensionDir, '.tmp-servers-entry');
  mkdirSync(entryDir, { recursive: true });
  try {
    const entry = path.join(entryDir, 'servers-entry.ts');
    writeFileSync(entry, SERVERS_ENTRY);
    await build({ ...extensionBuild, config: false, cwd: extensionDir, entry: { 'servers-entry': entry }, outDir: dist });
  } finally {
    rmSync(entryDir, { recursive: true, force: true });
  }

  let nativeDir: string | undefined;
  let nativeSkipReason: string | undefined;
  const host = hostTarget() as string;
  if (!Object.hasOwn(TARGETS as object, host)) {
    nativeSkipReason = `no native staging for ${host}`;
  } else {
    try {
      const staged = stageNative({ extensionDir, outDir: path.join(dist, 'native') }) as { outDir: string };
      nativeDir = staged.outDir;
    } catch (error) {
      nativeSkipReason = `native staging unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  project.provide('bundle', {
    root,
    extensionJs: path.join(dist, 'extension.js'),
    serversEntry: path.join(dist, 'servers-entry.js'),
    helperJs: path.join(dist, 'mcp-headers.js'),
    externalImports,
    nativeDir,
    nativeSkipReason,
  });
  return () => {
    rmSync(root, { recursive: true, force: true });
  };
}
