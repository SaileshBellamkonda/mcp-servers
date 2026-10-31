#!/usr/bin/env node
// Bundles a server package's entry points (src/standalone.ts, src/embedded.ts) into dist/*.js with esbuild.
//
// The private shared packages (@mcp-servers/*) are inlined, from source, so the published/npx-run server needs
// no unpublished package. Everything declared in `dependencies` or `peerDependencies` (third-party packages,
// including native modules) and every Node built-in stays external and is resolved at runtime.
//
// Usage: node scripts/bundle-server.mjs <package-dir>
import { readFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCE_CONDITION, loadEsbuild } from './bundle-common.mjs';

/** Packages that are private to this repository and therefore always inlined. */
const INLINED_SCOPE = '@mcp-servers/';

/**
 * Names that must stay external for the package described by `manifest`: every declared dependency and
 * peer dependency except the private `@mcp-servers/*` packages.
 * @param {{ dependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} manifest
 * @returns {string[]}
 */
export function externalPackages(manifest) {
  const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];
  return [...new Set(names)].filter((name) => !name.startsWith(INLINED_SCOPE)).sort();
}

/**
 * esbuild options for bundling the package in `packageDir`. Pass `outdir` to redirect the output (tests do).
 * @param {string} packageDir
 * @param {{ outdir?: string }} [overrides]
 * @returns {import('esbuild').BuildOptions}
 */
export function bundleOptions(packageDir, overrides = {}) {
  const root = path.resolve(packageDir);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const external = externalPackages(manifest).flatMap((name) => [name, `${name}/*`]);
  return {
    absWorkingDir: root,
    entryPoints: { standalone: 'src/standalone.ts', embedded: 'src/embedded.ts' },
    outdir: overrides.outdir ?? path.join(root, 'dist'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    sourcemap: true,
    conditions: [SOURCE_CONDITION],
    external,
    metafile: true,
    logLevel: 'warning',
  };
}

/**
 * Runs the bundle for `packageDir`, resolving esbuild from that package (it is a devDependency there).
 * @param {string} packageDir
 */
export async function bundleServer(packageDir) {
  const root = path.resolve(packageDir);
  const { build } = loadEsbuild(root);
  const options = bundleOptions(root);
  const result = await build(options);
  // npm sets the executable bit on `bin` files at install time; keep the local build runnable too.
  await chmod(path.join(String(options.outdir), 'standalone.js'), 0o755);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packageDir = process.argv[2];
  if (!packageDir) {
    process.stderr.write('Usage: node scripts/bundle-server.mjs <package-dir>\n');
    process.exit(2);
  }
  bundleServer(packageDir).catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
}
