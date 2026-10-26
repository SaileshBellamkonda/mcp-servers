import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRegularFile, UnsafePathError, writeFileAtomic } from '../../src/core/safe-file';

const posix = process.platform !== 'win32';

describe('safe-file', () => {
  let root: string;
  let file: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'safe-file-'));
    file = path.join(root, 'target.json');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('readRegularFile', () => {
    it('returns the text of a regular file and undefined when it does not exist', async () => {
      writeFileSync(file, 'hello');
      expect(await readRegularFile(file)).toBe('hello');
      expect(await readRegularFile(path.join(root, 'missing'))).toBeUndefined();
    });

    it('refuses a directory', async () => {
      mkdirSync(path.join(root, 'dir'));
      await expect(readRegularFile(path.join(root, 'dir'))).rejects.toBeInstanceOf(UnsafePathError);
    });

    it.runIf(posix)('refuses a symlink, even to a regular file, without reading through it', async () => {
      const outside = path.join(root, 'outside.txt');
      writeFileSync(outside, 'secret');
      symlinkSync(outside, file);
      await expect(readRegularFile(file)).rejects.toThrow(/symbolic link/i);
    });

    it.runIf(posix)('refuses a dangling symlink', async () => {
      symlinkSync(path.join(root, 'nowhere'), file);
      await expect(readRegularFile(file)).rejects.toBeInstanceOf(UnsafePathError);
    });
  });

  describe('writeFileAtomic', () => {
    it('creates the file and leaves no temporary files', async () => {
      await writeFileAtomic(file, 'one');
      expect(readFileSync(file, 'utf8')).toBe('one');
      expect(readdirSync(root)).toEqual(['target.json']);
    });

    it('replaces an existing regular file and keeps its mode', async () => {
      writeFileSync(file, 'old');
      if (posix) chmodSync(file, 0o600);
      await writeFileAtomic(file, 'new');
      expect(readFileSync(file, 'utf8')).toBe('new');
      if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(root)).toEqual(['target.json']);
    });

    it.runIf(posix)('refuses a symlink and leaves both the link and its target untouched', async () => {
      const outside = path.join(root, 'outside.txt');
      writeFileSync(outside, 'precious');
      symlinkSync(outside, file);
      await expect(writeFileAtomic(file, 'overwritten')).rejects.toThrow(/symbolic link/i);
      expect(readFileSync(outside, 'utf8')).toBe('precious');
      expect(statSync(file).isFile()).toBe(true);
      expect(readdirSync(root).sort()).toEqual(['outside.txt', 'target.json']);
    });

    it.runIf(posix)('refuses a dangling symlink (it would create the target elsewhere)', async () => {
      const elsewhere = path.join(root, 'created-elsewhere');
      symlinkSync(elsewhere, file);
      await expect(writeFileAtomic(file, 'x')).rejects.toBeInstanceOf(UnsafePathError);
      expect(() => statSync(elsewhere)).toThrow();
    });

    it('refuses a directory', async () => {
      mkdirSync(file);
      await expect(writeFileAtomic(file, 'x')).rejects.toBeInstanceOf(UnsafePathError);
    });

    it('cleans its temporary file up when the write cannot complete (missing directory)', async () => {
      await expect(writeFileAtomic(path.join(root, 'no', 'such', 'dir', 'f'), 'x')).rejects.toThrow();
      expect(readdirSync(root)).toEqual([]);
    });
  });
});
