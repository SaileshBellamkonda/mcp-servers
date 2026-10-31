import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import { PathGuard } from '../../../src/core/path-guard.ts';

const posix = (p: string): string => p.replace(/\\/g, '/');

let base: string;
let root: string;
let outside: string;

function md(...segments: string[]): string {
  const file = path.join(...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '# doc\n');
  return posix(file);
}

function link(target: string, at: string): void {
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(target, at, 'dir');
}

function matcher(extra?: ConstructorParameters<typeof GlobMatcher>[4]): GlobMatcher {
  return new GlobMatcher([`${posix(root)}/**/*.md`], [], root, false, extra);
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-walk-')));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('GlobMatcher.findFiles with symlinks', () => {
  it('terminates quickly on parent-directory symlink cycles and lists every file once', () => {
    const a = md(root, 'a', 'doc.md');
    link('..', path.join(root, 'a', 'loop1'));
    link('..', path.join(root, 'a', 'loop2'));
    link('.', path.join(root, 'self'));
    const top = md(root, 'top.md');

    const started = Date.now();
    const files = matcher().findFiles();

    expect(Date.now() - started).toBeLessThan(2000);
    expect(files).toEqual([a, top].sort());
    expect(new Set(files).size).toBe(files.length);
  }, 10_000);

  it('does not follow a symlinked directory that points outside the roots', () => {
    md(outside, 'secret.md');
    const inside = md(root, 'ok.md');
    link(outside, path.join(root, 'escape'));
    expect(matcher().findFiles()).toEqual([inside]);
  });

  it('skips a symlinked file whose real path escapes the roots', () => {
    const secret = md(outside, 'secret.md');
    const inside = md(root, 'ok.md');
    symlinkSync(secret, path.join(root, 'leak.md'));
    expect(matcher().findFiles()).toEqual([inside]);
  });

  it('keeps a symlinked file that resolves inside the roots', () => {
    const real = md(root, 'real.md');
    symlinkSync(real, path.join(root, 'alias.md'));
    expect(matcher().findFiles()).toEqual([posix(path.join(root, 'alias.md')), real].sort());
  });

  it('skips a symlinked directory that points at a tree already being walked', () => {
    const real = md(root, 'docs', 'a.md');
    link(path.join(root, 'docs'), path.join(root, 'mirror'));
    expect(matcher().findFiles()).toEqual([real]);
  });

  it('follows a symlinked directory into another allowed root exactly once, even when it cycles back', () => {
    const shared = md(outside, 'shared.md');
    link(outside, path.join(outside, 'again'));
    link(outside, path.join(root, 'ext1'));
    link(outside, path.join(root, 'ext2'));
    const inside = md(root, 'ok.md');

    const files = matcher({ pathGuard: new PathGuard([root, outside]) }).findFiles();

    expect(files).toContain(inside);
    const viaLinks = files.filter((f) => f.endsWith('shared.md'));
    expect(viaLinks).toHaveLength(1);
    expect(viaLinks[0]).toMatch(/\/root\/ext[12]\/shared\.md$/);
    expect(shared).toBeTruthy();
    expect(files.some((f) => f.includes('/again/'))).toBe(false);
  }, 10_000);

  it('stops at the depth cap with a warning', () => {
    let dir = root;
    for (let i = 0; i < 6; i++) dir = path.join(dir, `d${String(i)}`);
    md(dir, 'deep.md');
    const top = md(root, 'top.md');
    const warn = vi.fn();
    const files = matcher({ maxDepth: 3, warn }).findFiles();
    expect(files).toEqual([top]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/depth/i);
  });

  it('stops at the entry cap with a warning', () => {
    for (let i = 0; i < 20; i++) md(root, `f${String(i).padStart(2, '0')}.md`);
    const warn = vi.fn();
    const files = matcher({ maxEntries: 5, warn }).findFiles();
    expect(files.length).toBeLessThanOrEqual(5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/entries/i);
  });
});
