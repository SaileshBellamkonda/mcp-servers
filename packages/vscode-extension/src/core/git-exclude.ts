import { lstatSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readRegularFile, statRealDirectory, UnsafePathError, writeFileAtomic } from './safe-file';

/** True when `<folder>/.git` is a real directory (not a symbolic link, and not the pointer file of a worktree). */
export function isGitDirectory(folder: string): boolean {
  try {
    return lstatSync(path.join(folder, '.git')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Adds `entry` to `<folder>/.git/info/exclude` unless it is already there. Only plain files and directories are
 * touched: a symbolic link at `.git`, `.git/info` or `exclude` (which could send the write anywhere), or a `.git`
 * file, is refused with an `UnsafePathError`. The file is replaced through a temporary file and a rename.
 */
export async function excludeFromGit(folder: string, entry: string): Promise<'added' | 'present'> {
  const gitDir = path.join(folder, '.git');
  if (!(await statRealDirectory(gitDir))) throw new UnsafePathError(`${gitDir} does not exist`);
  const infoDir = path.join(gitDir, 'info');
  if (!(await statRealDirectory(infoDir))) await mkdir(infoDir);
  const file = path.join(infoDir, 'exclude');
  const current = (await readRegularFile(file)) ?? '';
  if (current.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === `/${entry}`)) return 'present';
  await writeFileAtomic(file, `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${entry}\n`);
  return 'added';
}
