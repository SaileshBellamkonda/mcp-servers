import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
// @ts-expect-error -- plain ESM script without declarations
import { stageNative, hostTarget, TARGETS } from '../../../../scripts/stage-native.mjs';

/** What the bundle tests share: one bundle + staged natives built once into a temporary directory. */
export interface BundleFixture {
  /** Directory holding `dist/` (a copy of what `pnpm run build` and `stage:native` produce). */
  root: string;
  /** `<root>/dist/extension.js` */
  extensionJs: string;
  /** `<root>/dist/mcp-headers.js`: the dependency-free headersHelper script. */
  helperJs: string;
  /** `<root>/dist/servers-entry.cjs`: the same bundle options, exporting the embedded server entry points. */
  serversEntry: string;
  /** Every module the extension bundle leaves external, per esbuild's metafile (should be `vscode` and built-ins). */
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

/** The flags of the package's `bundle` script, without its entry points and output locations (tests set their own). */
function bundleFlags(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'package.json'), 'utf8')) as { scripts: { bundle: string } };
  return manifest.scripts.bundle
    .split(/\s+/)
    .filter((token) => token.startsWith('--') && !token.startsWith('--outdir=') && !token.startsWith('--metafile='));
}

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
  const metafilePath = path.join(root, 'meta.json');
  execFileSync('pnpm', ['run', 'bundle', `--outdir=${dist}`, `--metafile=${metafilePath}`], { cwd: extensionDir, stdio: 'pipe' });
  const built = {
    metafile: JSON.parse(readFileSync(metafilePath, 'utf8')) as {
      inputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
    },
  };
  const externalImports = [
    ...new Set(
      Object.values(built.metafile.inputs)
        .flatMap((input) => input.imports)
        .filter((imported) => imported.external === true)
        .map((imported) => imported.path)
    ),
  ].sort();
  // The entry lives inside the extension directory so its bare specifiers resolve from the extension's node_modules.
  const entryDir = path.join(extensionDir, '.tmp-servers-entry');
  mkdirSync(entryDir, { recursive: true });
  try {
    const entry = path.join(entryDir, 'servers-entry.ts');
    writeFileSync(entry, SERVERS_ENTRY);
    execFileSync('pnpm', ['exec', 'esbuild', entry, ...bundleFlags(), `--outfile=${path.join(dist, 'servers-entry.cjs')}`], {
      cwd: extensionDir,
      stdio: 'pipe',
    });
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
    serversEntry: path.join(dist, 'servers-entry.cjs'),
    helperJs: path.join(dist, 'mcp-headers.js'),
    externalImports,
    nativeDir,
    nativeSkipReason,
  });
  return () => {
    rmSync(root, { recursive: true, force: true });
  };
}
