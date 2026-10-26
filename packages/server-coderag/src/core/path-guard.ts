import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { GlobConfig } from './types.js';
import { extractGlobBase, resolveToAbsolute } from './glob-utils.js';

const MAX_SYMLINK_HOPS = 40;

export class PathNotAllowedError extends Error {
  constructor(offendingPath: string, allowedRoots: readonly string[]) {
    const roots = allowedRoots.length > 0 ? allowedRoots.join(', ') : '(none)';
    super(
      `Path not allowed: "${offendingPath}" is outside the allowed roots (${roots}). ` +
      'Set CODERAG_ALLOWED_ROOTS (semicolon-separated directories) to allow additional locations.',
    );
    this.name = 'PathNotAllowedError';
  }
}

/** True when `target` is `root` or lies below it. Pure string comparison on already-resolved absolute paths. */
export function isPathWithin(root: string, target: string, caseInsensitive = process.platform === 'win32'): boolean {
  const r = caseInsensitive ? root.toLowerCase() : root;
  const t = caseInsensitive ? target.toLowerCase() : target;
  const rel = path.relative(r, t);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function isMissingError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Real path of `abs`, tolerating a path that does not exist yet: the deepest existing ancestor is
 * resolved through the filesystem and the missing segments are appended. Dangling symlinks are
 * followed to their (possibly non-existent) target. Returns null when the path cannot be resolved.
 */
function resolveReal(abs: string, hops = 0): string | null {
  if (hops > MAX_SYMLINK_HOPS) return null;
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...rest);
    } catch (err) {
      if (!isMissingError(err)) return null;
    }
    try {
      if (lstatSync(current).isSymbolicLink()) {
        const target = path.resolve(path.dirname(current), readlinkSync(current));
        return resolveReal(path.join(target, ...rest), hops + 1);
      }
    } catch (err) {
      if (!isMissingError(err)) return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.join(current, ...rest);
    rest.unshift(path.basename(current));
    current = parent;
  }
}

/**
 * Confines file-system access to a set of root directories. Symlinks are resolved before the
 * comparison, so a link inside a root that points outside it is rejected.
 */
export class PathGuard {
  private readonly lexicalRoots: string[];
  private readonly realRoots: string[];

  constructor(roots: readonly string[]) {
    const lexical = [...new Set(roots.map((r) => path.resolve(r)))];
    this.lexicalRoots = lexical;
    this.realRoots = [...new Set(lexical.map((r) => resolveReal(r) ?? r))];
  }

  get roots(): readonly string[] {
    return this.lexicalRoots;
  }

  /**
   * Returns the absolute (lexical) path when its real path lies inside a root and throws
   * PathNotAllowedError otherwise. Relative inputs resolve against the first root.
   *
   * The lexical path is a stable identity (index keys, messages) but must not be used for file I/O:
   * a symlink swapped in after the check would be followed. Use `assertAllowedReal` for reads and writes.
   */
  assertAllowed(p: string): string {
    return this.check(p).abs;
  }

  /** Like `assertAllowed`, but returns the resolved real path so the caller operates on exactly what was checked. */
  assertAllowedReal(p: string): string {
    return this.check(p).real;
  }

  private check(p: string): { abs: string; real: string } {
    const abs = path.resolve(this.lexicalRoots[0] ?? process.cwd(), p);
    const real = resolveReal(abs);
    if (real === null || !this.realRoots.some((root) => isPathWithin(root, real))) {
      throw new PathNotAllowedError(p, this.lexicalRoots);
    }
    return { abs, real };
  }

  isAllowed(p: string): boolean {
    try {
      this.assertAllowed(p);
      return true;
    } catch (err) {
      if (err instanceof PathNotAllowedError) return false;
      throw err;
    }
  }
}

export interface AllowedRootsInput {
  /** Process cwd (standalone) or the workspace folders (embedded). The first entry anchors relative globs. */
  cwdOrFolders: string[];
  globs: GlobConfig;
  extraRoots: string[];
}

/** Folders, the static base directory of every include glob, and the extra roots; de-duplicated, in that order. */
export function computeAllowedRoots({ cwdOrFolders, globs, extraRoots }: AllowedRootsInput): string[] {
  const anchor = cwdOrFolders[0] ?? process.cwd();
  const roots: string[] = cwdOrFolders.map((f) => path.resolve(f));
  for (const pattern of [...globs.docsInclude, ...globs.codeInclude]) {
    if (pattern.startsWith('!')) continue;
    roots.push(path.resolve(extractGlobBase(resolveToAbsolute(pattern, anchor))));
  }
  roots.push(...extraRoots.map((r) => path.resolve(r)));
  return [...new Set(roots)];
}
