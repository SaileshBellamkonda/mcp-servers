#!/usr/bin/env node
// Builds a VSIX for one target: bundle -> stage the native modules for that target -> `vsce package`.
//
// Usage (from the extension package): node ../../scripts/package-extension.mjs [--target <vsce-target>] [--out <file-or-dir>]
// The VSIX is not committed (*.vsix is ignored). Staging another platform's natives needs its sqlite-vec platform
// package installed; the error says what is missing.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleExtension } from './bundle-extension.mjs';
import { hostTarget, parseTarget, stageNative } from './stage-native.mjs';

/**
 * @param {string[]} argv
 * @param {{ host?: string }} [defaults]
 * @returns {{ target: string, out: string | undefined }}
 */
export function parseArgs(argv, defaults = {}) {
  const args = { target: defaults.host ?? hostTarget(), out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--target' || flag === '--out') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--target') args.target = value;
      else args.out = value;
      i++;
    } else {
      throw new Error(`Unknown argument "${flag ?? ''}". Usage: package-extension.mjs [--target <t>] [--out <path>]`);
    }
  }
  parseTarget(args.target);
  return args;
}

/** Arguments for `vsce`. `--no-dependencies`: everything is bundled or staged; `--skip-license`: the repository has no LICENSE file. */
export function vsceArguments({ target, out }) {
  return ['package', '--no-dependencies', '--skip-license', '--target', target, ...(out === undefined ? [] : ['--out', out])];
}

/** @param {string} extensionDir */
function vsceEntry(extensionDir) {
  const manifest = createRequire(path.join(extensionDir, 'package.json')).resolve('@vscode/vsce/package.json');
  return path.join(path.dirname(manifest), JSON.parse(readFileSync(manifest, 'utf8')).bin.vsce);
}

/**
 * @param {string} extensionDir
 * @param {{ target: string, out: string | undefined }} options
 */
export async function packageExtension(extensionDir, options) {
  const root = path.resolve(extensionDir);
  await bundleExtension(root);
  const staged = stageNative({ extensionDir: root, target: options.target, log: (message) => process.stdout.write(`${message}\n`) });
  process.stdout.write(`staged native modules for ${staged.target}\n`);
  const run = spawnSync(process.execPath, [vsceEntry(root), ...vsceArguments(options)], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`vsce exited with ${String(run.status)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await packageExtension(process.cwd(), parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
