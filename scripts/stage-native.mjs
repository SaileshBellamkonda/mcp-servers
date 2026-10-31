#!/usr/bin/env node
// Stages the native modules CodeRAG needs (tree-sitter, its grammars, node-gyp-build, sqlite-vec and its
// platform package) as REAL directories under <extension>/dist/native/node_modules/<name>, holding only what is
// needed at runtime: package.json, the JS entry, licence files and the prebuilt binary for ONE target.
//
// Why there: `vsce package --no-dependencies` globs with `ignore: node_modules/**` (relative to the extension
// root), so a top-level node_modules would be dropped, while dist/native/node_modules is kept. The extension
// resolves bare specifiers from here with createRequire(path.join(__dirname, 'native', 'index.js')); the
// placeholder dist/native/index.js only gives that call a file inside this directory.
//
// Usage: node scripts/stage-native.mjs [--target <vsce-target>] [--extension-dir <dir>] [--out <dir>]
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * vsce targets this extension ships. `vecPackage` is the platform package of sqlite-vec holding the loadable
 * extension (`vec0.<ext>`); sqlite-vec has no win32-arm64 or musl package, so those targets are not offered.
 */
export const TARGETS = {
  'linux-x64': { platform: 'linux', arch: 'x64', vecPackage: 'sqlite-vec-linux-x64', loadable: 'vec0.so' },
  'linux-arm64': { platform: 'linux', arch: 'arm64', vecPackage: 'sqlite-vec-linux-arm64', loadable: 'vec0.so' },
  'darwin-x64': { platform: 'darwin', arch: 'x64', vecPackage: 'sqlite-vec-darwin-x64', loadable: 'vec0.dylib' },
  'darwin-arm64': { platform: 'darwin', arch: 'arm64', vecPackage: 'sqlite-vec-darwin-arm64', loadable: 'vec0.dylib' },
  'win32-x64': { platform: 'win32', arch: 'x64', vecPackage: 'sqlite-vec-windows-x64', loadable: 'vec0.dll' },
};

/** The vsce target name of the machine running this script. */
export function hostTarget() {
  return `${process.platform}-${process.arch}`;
}

/**
 * @param {string} name vsce target such as `linux-x64`
 * @returns {{ name: string, platform: string, arch: string, vecPackage: string, loadable: string }}
 */
export function parseTarget(name) {
  const target = Object.hasOwn(TARGETS, name) ? TARGETS[name] : undefined;
  if (!target) {
    throw new Error(`Unsupported target "${name}". Supported: ${Object.keys(TARGETS).join(', ')}.`);
  }
  return { name, ...target };
}

/** Files besides the entry that a package's entry requires at load time. */
const RUNTIME_EXTRAS = { 'node-gyp-build': ['node-gyp-build.js'] };

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.[a-z]+)?$/i;

/**
 * Picks the files of one package that are needed at runtime. Pure: works on a list of POSIX relative paths.
 * @param {{ manifest: { name?: string, main?: string }, files: string[], target: { name: string, loadable: string } }} input
 * @returns {string[]} sorted relative paths (a subset of `files`)
 */
export function selectPackageFiles({ manifest, files, target }) {
  const available = new Set(files);
  const selected = new Set();
  if (available.has('package.json')) selected.add('package.json');

  const main = (manifest.main ?? 'index.js').replace(/^\.\//, '');
  for (const candidate of [main, `${main}.js`, `${main}/index.js`]) {
    if (available.has(candidate)) {
      selected.add(candidate);
      break;
    }
  }

  for (const extra of RUNTIME_EXTRAS[manifest.name] ?? []) {
    if (available.has(extra)) selected.add(extra);
  }

  const prebuildPrefix = `prebuilds/${target.name}/`;
  for (const file of files) {
    if (file.startsWith(prebuildPrefix) || /^build\/Release\/[^/]+\.node$/.test(file)) selected.add(file);
    else if (file === target.loadable) selected.add(file);
    else if (!file.includes('/') && LICENSE_FILE.test(file)) selected.add(file);
  }
  return [...selected].sort();
}

/** Every file below `dir`, as sorted POSIX paths relative to it (follows nothing: pnpm package dirs are real). */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Directory of package `name` as seen from `req`, without relying on the package exporting its package.json.
 * @param {NodeJS.Require} req
 * @param {string} name
 * @param {string} [probe] a file inside the package to resolve instead (loadable-only packages have no JS entry)
 * @returns {string | undefined} the real (symlink-free) package directory
 */
function findPackageDir(req, name, probe) {
  const attempts = probe ? [`${name}/${probe}`] : [`${name}/package.json`, name];
  for (const request of attempts) {
    let resolved;
    try {
      resolved = req.resolve(request);
    } catch {
      continue;
    }
    let dir = path.dirname(realpathSync(resolved));
    for (;;) {
      const manifest = path.join(dir, 'package.json');
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

/** Native packages CodeRAG loads: the tree-sitter family and sqlite-vec, as declared by its package.json. */
function nativeDependencyNames(coderagManifest) {
  return Object.keys(coderagManifest.dependencies ?? {})
    .filter((name) => name === 'tree-sitter' || name.startsWith('tree-sitter-') || name === 'sqlite-vec')
    .sort();
}

/**
 * Locates the packages to stage.
 * @param {string} extensionDir the extension package (it depends on @mcp-servers/server-coderag)
 * @param {{ name: string, vecPackage: string, loadable: string }} target
 * @returns {{ name: string, dir: string }[]}
 */
export function resolveNativePackages(extensionDir, target) {
  const link = path.join(extensionDir, 'node_modules', '@mcp-servers', 'server-coderag');
  if (!existsSync(link)) {
    throw new Error(`${link} not found. Run "pnpm install" first (the extension depends on @mcp-servers/server-coderag).`);
  }
  const coderagDir = realpathSync(link);
  const coderagManifest = JSON.parse(readFileSync(path.join(coderagDir, 'package.json'), 'utf8'));
  const coderagRequire = createRequire(path.join(coderagDir, 'package.json'));

  const packages = [];
  for (const name of nativeDependencyNames(coderagManifest)) {
    const dir = findPackageDir(coderagRequire, name);
    if (!dir) throw new Error(`Cannot resolve "${name}" from ${coderagDir}. Run "pnpm install".`);
    packages.push({ name, dir });
  }

  const treeSitter = packages.find((p) => p.name === 'tree-sitter');
  const sqliteVec = packages.find((p) => p.name === 'sqlite-vec');
  if (!treeSitter || !sqliteVec) {
    throw new Error('server-coderag must depend on tree-sitter and sqlite-vec.');
  }

  const gypBuild = findPackageDir(createRequire(path.join(treeSitter.dir, 'package.json')), 'node-gyp-build');
  if (!gypBuild) throw new Error(`Cannot resolve "node-gyp-build" from ${treeSitter.dir}.`);
  packages.push({ name: 'node-gyp-build', dir: gypBuild });

  const vecPlatform = findPackageDir(createRequire(path.join(sqliteVec.dir, 'package.json')), target.vecPackage, target.loadable);
  if (!vecPlatform) {
    throw new Error(
      `${target.vecPackage} is not installed, so the ${target.name} build of sqlite-vec cannot be staged. ` +
        'pnpm installs only the optional platform package matching this machine. Stage this target on a matching ' +
        'machine, or list the other platforms under "supportedArchitectures" in pnpm-workspace.yaml ' +
        '(os: [linux, darwin, win32], cpu: [x64, arm64]), run "pnpm install", and retry.'
    );
  }
  packages.push({ name: target.vecPackage, dir: vecPlatform });
  return packages;
}

/**
 * Stages the native modules for `target` into `<outDir>/node_modules` and writes `<outDir>/index.js`.
 * @param {{ extensionDir: string, outDir?: string, target?: string, log?: (message: string) => void }} options
 * @returns {{ outDir: string, target: string, packages: { name: string, files: number, bytes: number }[] }}
 */
export function stageNative(options) {
  const extensionDir = path.resolve(options.extensionDir);
  const target = parseTarget(options.target ?? hostTarget());
  const outDir = path.resolve(options.outDir ?? path.join(extensionDir, 'dist', 'native'));
  const packages = resolveNativePackages(extensionDir, target);

  // Select everything first so a missing prebuild fails before anything is written.
  const plans = packages.map(({ name, dir }) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const files = selectPackageFiles({ manifest, files: listFiles(dir), target });
    const needsBinary = name === 'tree-sitter' || name.startsWith('tree-sitter-') || name === target.vecPackage;
    const hasBinary = files.some((f) => f.startsWith('prebuilds/') || f.startsWith('build/Release/') || f === target.loadable);
    if (needsBinary && !hasBinary) {
      throw new Error(`${name} ships no binary for ${target.name} (looked for prebuilds/${target.name}/ and build/Release/).`);
    }
    return { name, dir, files };
  });

  rmSync(outDir, { recursive: true, force: true });
  const nodeModules = path.join(outDir, 'node_modules');
  const staged = [];
  for (const { name, dir, files } of plans) {
    let bytes = 0;
    for (const file of files) {
      const destination = path.join(nodeModules, name, ...file.split('/'));
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(dir, ...file.split('/')), destination, { dereference: true });
      bytes += statSync(destination).size;
    }
    staged.push({ name, files: files.length, bytes });
    options.log?.(`staged ${name} (${String(files.length)} files)`);
  }
  writeFileSync(
    path.join(outDir, 'index.js'),
    '// Placeholder: the extension calls createRequire(<this file>) so bare specifiers resolve from ./node_modules.\n'
  );
  return { outDir, target: target.name, packages: staged };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { target: undefined, extensionDir: process.cwd(), out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--target' || flag === '--extension-dir' || flag === '--out') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--target') args.target = value;
      else if (flag === '--extension-dir') args.extensionDir = value;
      else args.out = value;
      i++;
    } else {
      throw new Error(`Unknown argument "${flag ?? ''}". Usage: stage-native.mjs [--target <t>] [--extension-dir <dir>] [--out <dir>]`);
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = stageNative({
      extensionDir: args.extensionDir,
      ...(args.out !== undefined && { outDir: args.out }),
      ...(args.target !== undefined && { target: args.target }),
      log: (message) => process.stdout.write(`${message}\n`),
    });
    const total = result.packages.reduce((sum, p) => sum + p.bytes, 0);
    process.stdout.write(`native modules for ${result.target} staged in ${result.outDir} (${(total / 1048576).toFixed(1)} MB)\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
