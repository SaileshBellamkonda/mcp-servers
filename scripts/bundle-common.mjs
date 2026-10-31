// Pieces shared by bundle-server.mjs and bundle-extension.mjs.
import { createRequire } from 'node:module';
import path from 'node:path';

/** Export condition under which the workspace packages expose their TypeScript source. */
export const SOURCE_CONDITION = '@mcp-servers/source';

/**
 * esbuild, resolved from `packageDir` (it is a devDependency there).
 * @param {string} packageDir
 * @returns {typeof import('esbuild')}
 */
export function loadEsbuild(packageDir) {
  return createRequire(path.join(path.resolve(packageDir), 'package.json'))('esbuild');
}
