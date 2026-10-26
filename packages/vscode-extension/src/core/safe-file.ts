import { randomBytes } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A file the extension was asked to read or write is not a plain file (a symbolic link, a directory, ...). */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/**
 * `lstat`s `file` and returns its stats, undefined when it does not exist. Throws `UnsafePathError` for anything but
 * a regular file: a symbolic link (the extension never follows one, whatever it points at) or a directory.
 */
async function statRegularFile(file: string): Promise<{ mode: number } | undefined> {
  let stats;
  try {
    stats = await lstat(file);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined;
    throw error;
  }
  if (stats.isSymbolicLink()) throw new UnsafePathError(`${file} is a symbolic link; the extension does not follow links. Replace it with a regular file or remove it.`);
  if (!stats.isFile()) throw new UnsafePathError(`${file} is not a regular file`);
  return stats;
}

/** Throws `UnsafePathError` when `directory` exists and is a symbolic link or not a directory; false when it does not exist. */
export async function statRealDirectory(directory: string): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return false;
    throw error;
  }
  if (stats.isSymbolicLink()) throw new UnsafePathError(`${directory} is a symbolic link; the extension does not follow links.`);
  if (!stats.isDirectory()) throw new UnsafePathError(`${directory} is not a directory`);
  return true;
}

/** Reads a regular file as UTF-8; undefined when it does not exist; refuses symbolic links and other non-files. */
export async function readRegularFile(file: string): Promise<string | undefined> {
  if ((await statRegularFile(file)) === undefined) return undefined;
  return readFile(file, 'utf8');
}

/**
 * Writes `text` to `file` through a temporary file in the same directory and an atomic rename, so a reader never
 * sees a partial file and a link placed at `file` meanwhile is replaced, never followed. An existing regular file
 * keeps its mode; a symbolic link or other non-file at `file` is refused.
 */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const existing = await statRegularFile(file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: existing ? existing.mode & 0o777 : 0o644 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
