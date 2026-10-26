import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PathGuard,
  PathNotAllowedError,
  computeAllowedRoots,
  isPathWithin,
} from '../../../src/core/path-guard.js';
import type { GlobConfig } from '../../../src/core/types.js';

let base: string;
let root: string;
let outside: string;

function canSymlink(): boolean {
  try {
    const probeTarget = path.join(base, 'probe-target');
    mkdirSync(probeTarget);
    symlinkSync(probeTarget, path.join(base, 'probe-link'), 'junction');
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-pathguard-')));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(root, 'inside.md'), '# in');
  writeFileSync(path.join(outside, 'secret.md'), '# secret');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('PathGuard.assertAllowed', () => {
  it('allows a file inside the root and returns the absolute path', () => {
    const guard = new PathGuard([root]);
    const p = path.join(root, 'inside.md');
    expect(guard.assertAllowed(p)).toBe(p);
    expect(guard.isAllowed(p)).toBe(true);
  });

  it('allows the root itself', () => {
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(root)).toBe(true);
    expect(guard.assertAllowed(root)).toBe(root);
  });

  it('allows a nested directory', () => {
    mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    expect(new PathGuard([root]).isAllowed(path.join(root, 'a', 'b'))).toBe(true);
  });

  it('rejects ".." traversal out of the root', () => {
    const guard = new PathGuard([root]);
    const p = path.join(root, '..', 'outside', 'secret.md');
    expect(guard.isAllowed(p)).toBe(false);
    expect(() => guard.assertAllowed(p)).toThrow(PathNotAllowedError);
  });

  it('rejects an absolute path outside the root', () => {
    const guard = new PathGuard([root]);
    const p = path.join(outside, 'secret.md');
    expect(guard.isAllowed(p)).toBe(false);
    expect(() => guard.assertAllowed(p)).toThrow(PathNotAllowedError);
  });

  it('rejects a symlinked file inside the root that points outside', (ctx) => {
    if (!canSymlink()) ctx.skip();
    const link = path.join(root, 'link.md');
    symlinkSync(path.join(outside, 'secret.md'), link, 'file');
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(link)).toBe(false);
    expect(() => guard.assertAllowed(link)).toThrow(PathNotAllowedError);
  });

  it('rejects a path below a symlinked directory that points outside', (ctx) => {
    if (!canSymlink()) ctx.skip();
    const link = path.join(root, 'linkdir');
    symlinkSync(outside, link, 'junction');
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(link)).toBe(false);
    expect(guard.isAllowed(path.join(link, 'secret.md'))).toBe(false);
    expect(guard.isAllowed(path.join(link, 'not-yet.md'))).toBe(false);
  });

  it('rejects a dangling symlink whose target is outside the root', (ctx) => {
    if (!canSymlink()) ctx.skip();
    const link = path.join(root, 'dangling.md');
    symlinkSync(path.join(outside, 'does-not-exist.md'), link, 'file');
    expect(new PathGuard([root]).isAllowed(link)).toBe(false);
  });

  it('allows a symlink inside the root that points to another place inside the root', (ctx) => {
    if (!canSymlink()) ctx.skip();
    const link = path.join(root, 'alias.md');
    symlinkSync(path.join(root, 'inside.md'), link, 'file');
    expect(new PathGuard([root]).isAllowed(link)).toBe(true);
  });

  it('allows a root that is itself reached through a symlink', (ctx) => {
    if (!canSymlink()) ctx.skip();
    const rootLink = path.join(base, 'root-link');
    symlinkSync(root, rootLink, 'junction');
    const guard = new PathGuard([rootLink]);
    expect(guard.isAllowed(path.join(root, 'inside.md'))).toBe(true);
    expect(guard.isAllowed(path.join(rootLink, 'inside.md'))).toBe(true);
    expect(guard.isAllowed(path.join(outside, 'secret.md'))).toBe(false);
  });

  it('allows a non-existent file under the root', () => {
    const guard = new PathGuard([root]);
    const p = path.join(root, 'new', 'deeper', 'file.md');
    expect(guard.isAllowed(p)).toBe(true);
    expect(guard.assertAllowed(p)).toBe(p);
  });

  it('rejects a non-existent file outside the root', () => {
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(path.join(outside, 'new', 'file.md'))).toBe(false);
  });

  it('rejects a non-existent path that escapes through ".." segments', () => {
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(path.join(root, 'missing', '..', '..', 'outside', 'x.md'))).toBe(false);
  });

  it('rejects a sibling directory that only shares a name prefix with the root', () => {
    const sibling = path.join(base, 'rootX');
    mkdirSync(sibling);
    writeFileSync(path.join(sibling, 'a.md'), 'x');
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(path.join(sibling, 'a.md'))).toBe(false);
    expect(guard.isAllowed(sibling)).toBe(false);
  });

  it('allows paths under any of several roots', () => {
    const guard = new PathGuard([root, outside]);
    expect(guard.isAllowed(path.join(root, 'inside.md'))).toBe(true);
    expect(guard.isAllowed(path.join(outside, 'secret.md'))).toBe(true);
    expect(guard.isAllowed(path.join(base, 'elsewhere.md'))).toBe(false);
  });

  it('honours extra roots passed alongside the primary root', () => {
    const extra = path.join(base, 'extra');
    mkdirSync(extra);
    const guard = new PathGuard(computeAllowedRoots({
      cwdOrFolders: [root],
      globs: emptyGlobs(),
      extraRoots: [extra],
    }));
    expect(guard.isAllowed(path.join(extra, 'x.md'))).toBe(true);
    expect(guard.isAllowed(path.join(outside, 'secret.md'))).toBe(false);
  });

  it('resolves a relative path against the first root', () => {
    const guard = new PathGuard([root, outside]);
    expect(guard.assertAllowed('inside.md')).toBe(path.join(root, 'inside.md'));
    expect(new PathGuard([root, path.join(base, 'unrelated')]).isAllowed(path.join('..', 'outside', 'secret.md'))).toBe(false);
  });

  it('rejects everything when there are no roots', () => {
    expect(new PathGuard([]).isAllowed(path.join(root, 'inside.md'))).toBe(false);
  });

  it('names the offending path, the allowed roots and CODERAG_ALLOWED_ROOTS in the error', () => {
    const guard = new PathGuard([root]);
    const p = path.join(outside, 'secret.md');
    let error: unknown;
    try {
      guard.assertAllowed(p);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PathNotAllowedError);
    const e = error as PathNotAllowedError;
    expect(e.name).toBe('PathNotAllowedError');
    expect(e.message).toContain(p);
    expect(e.message).toContain(root);
    expect(e.message).toContain('CODERAG_ALLOWED_ROOTS');
  });

  it.skipIf(process.platform !== 'win32')('compares case-insensitively on win32', () => {
    const guard = new PathGuard([root]);
    expect(guard.isAllowed(path.join(root, 'inside.md').toUpperCase())).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('isPathWithin', () => {
  it('is case-sensitive by default on posix semantics and honours the flag', () => {
    expect(isPathWithin('/a/Root', '/a/root/x', true)).toBe(true);
    expect(isPathWithin('/a/Root', '/a/root/x', false)).toBe(false);
  });

  it('rejects sibling-prefix confusion and parent directories', () => {
    expect(isPathWithin('/a/root', '/a/rootX/x', false)).toBe(false);
    expect(isPathWithin('/a/root', '/a', false)).toBe(false);
    expect(isPathWithin('/a/root', '/a/root', false)).toBe(true);
  });
});

function emptyGlobs(): GlobConfig {
  return { docsInclude: [], docsExclude: [], codeInclude: [], codeExclude: [] };
}

describe.skipIf(process.platform === 'win32')('computeAllowedRoots', () => {
  it('includes the folders themselves', () => {
    expect(computeAllowedRoots({ cwdOrFolders: ['/w/a', '/w/b'], globs: emptyGlobs(), extraRoots: [] }))
      .toEqual(['/w/a', '/w/b']);
  });

  it('adds the static base of absolute globs', () => {
    const roots = computeAllowedRoots({
      cwdOrFolders: ['/w/a'],
      globs: { ...emptyGlobs(), docsInclude: ['/data/docs/**/*.md'], codeInclude: ['/data/src/**/*.ts'] },
      extraRoots: [],
    });
    expect(roots).toEqual(['/w/a', '/data/docs', '/data/src']);
  });

  it('resolves relative globs against the first folder', () => {
    const roots = computeAllowedRoots({
      cwdOrFolders: ['/w/a', '/w/b'],
      globs: { ...emptyGlobs(), docsInclude: ['docs/**/*.md', '**/*.md'], codeInclude: ['../shared/**/*.ts'] },
      extraRoots: [],
    });
    expect(roots).toEqual(['/w/a', '/w/b', '/w/a/docs', '/w/shared']);
  });

  it('uses the whole pattern when a glob has no wildcard', () => {
    const roots = computeAllowedRoots({
      cwdOrFolders: ['/w/a'],
      globs: { ...emptyGlobs(), docsInclude: ['/data/README.md'] },
      extraRoots: [],
    });
    expect(roots).toEqual(['/w/a', '/data/README.md']);
  });

  it('handles brace globs by their static prefix', () => {
    const roots = computeAllowedRoots({
      cwdOrFolders: ['/w/a'],
      globs: { ...emptyGlobs(), docsInclude: ['/data/{docs,notes}/**/*.md'], codeInclude: ['/src/lib/**/*.{ts,tsx}'] },
      extraRoots: [],
    });
    expect(roots).toEqual(['/w/a', '/data', '/src/lib']);
  });

  it('ignores negated include patterns and the exclude lists', () => {
    const roots = computeAllowedRoots({
      cwdOrFolders: ['/w/a'],
      globs: { docsInclude: ['!/etc/**'], docsExclude: ['/x/**'], codeInclude: [], codeExclude: ['/y/**'] },
      extraRoots: [],
    });
    expect(roots).toEqual(['/w/a']);
  });

  it('appends extra roots and de-duplicates', () => {
    const roots = computeAllowedRoots({
      cwdOrFolders: ['/w/a'],
      globs: { ...emptyGlobs(), docsInclude: ['**/*.md'] },
      extraRoots: ['/extra', '/w/a', '/extra'],
    });
    expect(roots).toEqual(['/w/a', '/extra']);
  });

  it('returns only the extra roots when no folders are given', () => {
    expect(computeAllowedRoots({ cwdOrFolders: [], globs: emptyGlobs(), extraRoots: ['/extra'] }))
      .toEqual(['/extra']);
  });
});

describe.skipIf(process.platform === 'win32')('PathGuard.assertAllowedReal', () => {
  it('returns the real path of a symlink that stays inside the roots', () => {
    writeFileSync(path.join(root, 'real.md'), '# r');
    symlinkSync(path.join(root, 'real.md'), path.join(root, 'alias.md'));
    const guard = new PathGuard([root]);
    expect(guard.assertAllowedReal(path.join(root, 'alias.md'))).toBe(path.join(root, 'real.md'));
    expect(guard.assertAllowed(path.join(root, 'alias.md'))).toBe(path.join(root, 'alias.md'));
  });

  it('throws for a symlink that leaves the roots', () => {
    writeFileSync(path.join(outside, 'secret.md'), '# s');
    symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
    expect(() => new PathGuard([root]).assertAllowedReal(path.join(root, 'leak.md'))).toThrow(PathNotAllowedError);
  });
});
