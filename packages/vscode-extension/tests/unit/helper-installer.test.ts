import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HELPER_FILE_NAME, installHeadersHelper } from '../../src/core/helper-installer';

describe('installHeadersHelper', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'helper-installer-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies the helper to <globalStorage>/bin/mcp-headers.js, creating the directory', async () => {
    const source = path.join(root, 'ext', 'dist', 'mcp-headers.js');
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, 'console.log("v1")');
    const target = await installHeadersHelper(source, path.join(root, 'globalStorage'));
    expect(HELPER_FILE_NAME).toBe('mcp-headers.js');
    expect(target).toBe(path.join(root, 'globalStorage', 'bin', 'mcp-headers.js'));
    expect(readFileSync(target, 'utf8')).toBe('console.log("v1")');
  });

  it('overwrites an older copy (extension upgrade) at the same path and leaves no temporary file', async () => {
    const source = path.join(root, 'mcp-headers.js');
    writeFileSync(source, 'v1');
    const first = await installHeadersHelper(source, path.join(root, 'gs'));
    writeFileSync(source, 'v2');
    const second = await installHeadersHelper(source, path.join(root, 'gs'));
    expect(second).toBe(first);
    expect(readFileSync(second, 'utf8')).toBe('v2');
    expect(readdirSync(path.dirname(second))).toEqual(['mcp-headers.js']);
  });

  it('rejects when the source is missing and leaves nothing behind', async () => {
    await expect(installHeadersHelper(path.join(root, 'missing.js'), path.join(root, 'gs'))).rejects.toThrow();
    expect(readdirSync(path.join(root, 'gs', 'bin'))).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('creates the bin directory with mode 0700 (umask 022) but leaves an existing one alone', async () => {
    const previous = process.umask(0o022);
    try {
      const source = path.join(root, 'mcp-headers.js');
      writeFileSync(source, 'v1');
      await installHeadersHelper(source, path.join(root, 'fresh'));
      expect(statSync(path.join(root, 'fresh', 'bin')).mode & 0o777).toBe(0o700);

      const existing = path.join(root, 'old', 'bin');
      mkdirSync(existing, { recursive: true });
      chmodSync(existing, 0o755);
      await installHeadersHelper(source, path.join(root, 'old'));
      expect(statSync(existing).mode & 0o777).toBe(0o755);
    } finally {
      process.umask(previous);
    }
  });
});
