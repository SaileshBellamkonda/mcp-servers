import { randomBytes } from 'node:crypto';
import { copyFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory } from './private-dir';

export const HELPER_FILE_NAME = 'mcp-headers.js';

/**
 * Copies the headers helper script to `<globalStorage>/bin/mcp-headers.js`, a path that does not contain the
 * extension version, so `.mcp.json` entries keep working across extension upgrades. The copy is atomic (temporary
 * file, then rename). Returns the target path.
 */
export async function installHeadersHelper(source: string, globalStorageDir: string): Promise<string> {
  const binDir = path.join(globalStorageDir, 'bin');
  await ensurePrivateDirectory(binDir);
  const target = path.join(binDir, HELPER_FILE_NAME);
  const temporary = path.join(binDir, `.${HELPER_FILE_NAME}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await copyFile(source, temporary);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return target;
}
