import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { excludeFromGit, isGitDirectory } from '../../src/core/git-exclude';
import { UnsafePathError } from '../../src/core/safe-file';

const posix = process.platform !== 'win32';

describe('git-exclude', () => {
  let root: string;
  let folder: string;
  let outside: string;
  const exclude = (): string => path.join(folder, '.git', 'info', 'exclude');
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'git-exclude-'));
    folder = path.join(root, 'work');
    outside = path.join(root, 'outside');
    mkdirSync(folder);
    mkdirSync(outside);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('isGitDirectory', () => {
    it('is true for a real .git directory only', () => {
      expect(isGitDirectory(folder)).toBe(false);
      mkdirSync(path.join(folder, '.git'));
      expect(isGitDirectory(folder)).toBe(true);
    });

    it('is false for a .git file (worktree pointer, not supported)', () => {
      writeFileSync(path.join(folder, '.git'), 'gitdir: ../elsewhere');
      expect(isGitDirectory(folder)).toBe(false);
    });

    it.runIf(posix)('is false for a symlinked .git', () => {
      symlinkSync(outside, path.join(folder, '.git'));
      expect(isGitDirectory(folder)).toBe(false);
    });
  });

  describe('excludeFromGit', () => {
    it('creates .git/info/exclude and adds the entry', async () => {
      mkdirSync(path.join(folder, '.git'));
      expect(await excludeFromGit(folder, '.mcp.json')).toBe('added');
      expect(readFileSync(exclude(), 'utf8')).toBe('.mcp.json\n');
    });

    it('appends to existing content (adding the missing newline) and never duplicates the entry', async () => {
      mkdirSync(path.join(folder, '.git', 'info'), { recursive: true });
      writeFileSync(exclude(), '# comment\n*.log');
      expect(await excludeFromGit(folder, '.mcp.json')).toBe('added');
      expect(readFileSync(exclude(), 'utf8')).toBe('# comment\n*.log\n.mcp.json\n');
      expect(await excludeFromGit(folder, '.mcp.json')).toBe('present');
      expect(readFileSync(exclude(), 'utf8')).toBe('# comment\n*.log\n.mcp.json\n');
    });

    it('recognises the anchored form and CRLF files as already excluded', async () => {
      mkdirSync(path.join(folder, '.git', 'info'), { recursive: true });
      writeFileSync(exclude(), 'x\r\n/.mcp.json\r\n');
      expect(await excludeFromGit(folder, '.mcp.json')).toBe('present');
    });

    it('goes through a temporary file: no leftovers next to the exclude file', async () => {
      mkdirSync(path.join(folder, '.git', 'info'), { recursive: true });
      writeFileSync(exclude(), 'a\n');
      await excludeFromGit(folder, '.mcp.json');
      expect(readdirSync(path.dirname(exclude()))).toEqual(['exclude']);
    });

    it('refuses when .git is not a directory (a worktree pointer file)', async () => {
      writeFileSync(path.join(folder, '.git'), 'gitdir: ../elsewhere');
      await expect(excludeFromGit(folder, '.mcp.json')).rejects.toBeInstanceOf(UnsafePathError);
    });

    it.runIf(posix)('refuses a symlinked .git and writes nothing through it', async () => {
      mkdirSync(path.join(outside, 'info'));
      symlinkSync(outside, path.join(folder, '.git'));
      await expect(excludeFromGit(folder, '.mcp.json')).rejects.toThrow(/symbolic link/i);
      expect(readdirSync(path.join(outside, 'info'))).toEqual([]);
    });

    it.runIf(posix)('refuses a symlinked .git/info and writes nothing through it', async () => {
      mkdirSync(path.join(folder, '.git'));
      symlinkSync(outside, path.join(folder, '.git', 'info'));
      await expect(excludeFromGit(folder, '.mcp.json')).rejects.toThrow(/symbolic link/i);
      expect(readdirSync(outside)).toEqual([]);
    });

    it.runIf(posix)('refuses a symlinked exclude file and leaves its target untouched', async () => {
      mkdirSync(path.join(folder, '.git', 'info'), { recursive: true });
      const target = path.join(outside, 'precious');
      writeFileSync(target, 'keep me\n');
      symlinkSync(target, exclude());
      await expect(excludeFromGit(folder, '.mcp.json')).rejects.toThrow(/symbolic link/i);
      expect(readFileSync(target, 'utf8')).toBe('keep me\n');
      expect(statSync(path.dirname(exclude())).isDirectory()).toBe(true);
    });
  });
});
