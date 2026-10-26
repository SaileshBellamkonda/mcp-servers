import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePrivateDirectory } from '../../src/core/private-dir';

const posix = process.platform !== 'win32';
const modeOf = (target: string): number => statSync(target).mode & 0o777;

describe.runIf(posix)('ensurePrivateDirectory (umask 022)', () => {
  let root: string;
  let previousUmask: number;
  beforeEach(() => {
    previousUmask = process.umask(0o022);
    root = mkdtempSync(path.join(tmpdir(), 'private-dir-'));
  });
  afterEach(() => {
    process.umask(previousUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a missing directory (and its missing parents) with mode 0700', async () => {
    const target = path.join(root, 'storage', 'abc');
    await ensurePrivateDirectory(target);
    expect(modeOf(target)).toBe(0o700);
    expect(modeOf(path.join(root, 'storage'))).toBe(0o700);
  });

  it('creates the directory even when the umask would allow group and other access', async () => {
    process.umask(0o000);
    const target = path.join(root, 'open');
    await ensurePrivateDirectory(target);
    expect(modeOf(target)).toBe(0o700);
  });

  it('leaves a directory that already exists alone: it was not created by us, so its mode is not ours to change', async () => {
    const target = path.join(root, 'existing');
    mkdirSync(target, { mode: 0o755 });
    chmodSync(target, 0o755);
    await ensurePrivateDirectory(target);
    expect(modeOf(target)).toBe(0o755);
  });

  it('is idempotent and keeps the 0700 of a directory it created', async () => {
    const target = path.join(root, 'twice');
    await ensurePrivateDirectory(target);
    await ensurePrivateDirectory(target);
    expect(modeOf(target)).toBe(0o700);
  });
});
