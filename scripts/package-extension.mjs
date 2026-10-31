#!/usr/bin/env node
// Builds a VSIX for one target: bundle -> stage the native modules for that target -> vsce's `createVSIX`.
//
// Usage (from the extension package): node ../../scripts/package-extension.mjs [--target <vsce-target>] [--out <file-or-dir>]
// The VSIX is not committed (*.vsix is ignored). Staging another platform's natives needs its sqlite-vec platform
// package installed; the error says what is missing.
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

/**
 * Options for vsce's `createVSIX`. `dependencies: false`: everything is bundled or staged; `skipLicense`: the
 * repository has no LICENSE file.
 * @param {{ target: string, out: string | undefined }} options
 * @param {string} cwd the extension directory
 */
export function vsceOptions({ target, out }, cwd) {
  return { cwd, target, dependencies: false, skipLicense: true, ...(out !== undefined && { packagePath: out }) };
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
  // vsce is a devDependency of the extension, so it is resolved from there.
  const { createVSIX } = createRequire(path.join(root, 'package.json'))('@vscode/vsce');
  await createVSIX(vsceOptions(options, root));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await packageExtension(process.cwd(), parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
