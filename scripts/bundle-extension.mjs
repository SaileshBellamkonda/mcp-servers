#!/usr/bin/env node
// Bundles the VS Code extension (src/extension.ts) into dist/extension.js: one CommonJS file for the extension host.
//
// Everything is inlined except `vscode` (provided by the host) and Node built-ins: the git and coderag servers
// are imported from their TypeScript source through the `@mcp-servers/source` export condition, which brings the
// private shared packages and every third-party runtime dependency (hono, zod, the MCP SDK, which, gray-matter,
// micromatch, ...) along, because nothing is installed next to an installed extension. The native modules that
// cannot be bundled (tree-sitter, its grammars, sqlite-vec) are staged separately by scripts/stage-native.mjs and
// located at run time through coderag's `nativeModulesDir` option; `node:sqlite` is a built-in loaded lazily.
//
// Usage: node scripts/bundle-extension.mjs <extension-dir>
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Export condition under which the workspace packages expose their TypeScript source. */
export const SOURCE_CONDITION = '@mcp-servers/source';

/**
 * esbuild options for the extension in `extensionDir`. `overrides` replace any option; passing `stdin` or
 * `outfile` drops the default `entryPoints` / `outdir` (tests use them to build a second entry point the same way).
 * @param {string} extensionDir
 * @param {import('esbuild').BuildOptions} [overrides]
 * @returns {import('esbuild').BuildOptions}
 */
export function extensionBundleOptions(extensionDir, overrides = {}) {
  const root = path.resolve(extensionDir);
  /** @type {import('esbuild').BuildOptions} */
  const options = {
    absWorkingDir: root,
    // `mcp-headers` is the standalone headersHelper script (no dependencies) that Claude Code runs; the extension
    // copies it to a stable path under its global storage at activation.
    entryPoints: { extension: 'src/extension.ts', 'mcp-headers': 'src/helper/mcp-headers.ts' },
    outdir: path.join(root, 'dist'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node24',
    sourcemap: true,
    minify: false,
    conditions: [SOURCE_CONDITION],
    external: ['vscode'],
    // CodeRAG only touches import.meta.url when no `nativeModulesDir` is given (standalone); the extension always
    // passes one, and the bundle test fails if that ever stops being true.
    logOverride: { 'empty-import-meta': 'silent' },
    metafile: true,
    logLevel: 'warning',
    ...overrides,
  };
  if (overrides.stdin) delete options.entryPoints;
  if (overrides.outfile) delete options.outdir;
  return options;
}

/**
 * Builds the bundle, resolving esbuild from the extension package (it is a devDependency there).
 * @param {string} extensionDir
 * @param {import('esbuild').BuildOptions} [overrides]
 */
export async function bundleExtension(extensionDir, overrides = {}) {
  const root = path.resolve(extensionDir);
  const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
  return build(extensionBundleOptions(root, overrides));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const extensionDir = process.argv[2];
  if (!extensionDir) {
    process.stderr.write('Usage: node scripts/bundle-extension.mjs <extension-dir>\n');
    process.exit(2);
  }
  bundleExtension(extensionDir).catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
}
