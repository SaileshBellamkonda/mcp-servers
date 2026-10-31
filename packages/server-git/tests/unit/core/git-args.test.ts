import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertSafeRefLike,
  assertBranchName,
  assertRemoteName,
  assertRemoteUrl,
  assertPathspecs,
  resolveRemote,
} from '../../../src/core/git-args.ts';
import { GitMcpError, ErrorCode } from '../../../src/core/types.ts';
import type { GitExecutor } from '../../../src/core/git-executor.ts';

const dashValues = ['-f', '--output=/tmp/x', '--upload-pack=touch /tmp/x', '--exec=id', '--help', '-'];

function expectRejected(fn: () => unknown): GitMcpError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GitMcpError);
    expect((e as GitMcpError).code).toBe(ErrorCode.VALIDATION_ERROR);
    return e as GitMcpError;
  }
  throw new Error('expected the validator to throw');
}

describe('assertSafeRefLike', () => {
  it.each(['HEAD', 'main', 'feature/x', 'HEAD~2', 'a1b2c3d', 'v1.0.0', 'origin/main', 'a..b', 'main:path/file.ts', 'a b.txt'])(
    'accepts %s',
    (v) => {
      expect(assertSafeRefLike(v, 'ref')).toBe(v);
    },
  );

  it.each([...dashValues, '', '   ', 'a\nb', 'a\0b', 'a\rb', 'a\x1fb', 'a\x7fb'])('rejects %j', (v) => {
    expectRejected(() => assertSafeRefLike(v, 'ref'));
  });

  it('names the offending input but never echoes its value', () => {
    const err = expectRejected(() => assertSafeRefLike('--output=/secret/path', 'target'));
    expect(err.message).toContain('target');
    expect(err.message).not.toContain('/secret/path');
    expect(JSON.stringify(err.details ?? {})).not.toContain('/secret/path');
  });
});

describe('assertBranchName', () => {
  it.each(['main', 'feature/x', 'release-1.2', 'HEAD', 'user/ünï'])('accepts %s', (v) => {
    expect(assertBranchName(v, 'branch')).toBe(v);
  });
  it.each([...dashValues, '', 'a:b', ':main', '+main', 'a..b', 'a b', 'a~1', 'a^', 'a?', 'a*', 'a[1]', 'a\\b', 'x@{1}', 'a/', 'a.lock', 'a\nb'])(
    'rejects %j',
    (v) => {
      expectRejected(() => assertBranchName(v, 'branch'));
    },
  );
});

describe('assertRemoteName', () => {
  it.each(['origin', 'upstream', 'my-fork', 'team/fork', 'r1.backup'])('accepts %s', (v) => {
    expect(assertRemoteName(v)).toBe(v);
  });
  it.each([...dashValues, '', 'a b', 'ext::sh -c id', 'https://x/y.git', '/abs/path', 'a\nb'])('rejects %j', (v) => {
    expectRejected(() => assertRemoteName(v));
  });
});

describe('assertRemoteUrl', () => {
  it.each(['https://github.com/o/r.git', 'ssh://git@host/o/r.git', 'git@github.com:o/r.git', '/srv/git/r.git', 'file:///srv/r.git', '../sibling.git'])(
    'accepts %s',
    (v) => {
      expect(assertRemoteUrl(v)).toBe(v);
    },
  );
  it.each([...dashValues, '', 'ext::sh -c id', 'fd::17', 'EXT::sh', 'a\nb', 'https://x/\0y'])('rejects %j', (v) => {
    expectRejected(() => assertRemoteUrl(v));
  });
  it('does not echo credentials embedded in a rejected URL', () => {
    const err = expectRejected(() => assertRemoteUrl('ext::sh -c "curl https://user:hunter2@evil"'));
    expect(err.message).not.toContain('hunter2');
  });
});

describe('assertPathspecs', () => {
  it('accepts explicit file names, including double dots inside a name', () => {
    expect(() => assertPathspecs(['src/a.ts', 'b..c.txt', './x.txt', 'dir/with space/f'])).not.toThrow();
  });
  it.each([...dashValues, '--pathspec-from-file=/etc/passwd', '--all', '-A', ':/', ':(top)x', ':!x', ':^x', ':(glob)*', '', 'a\0b', 'a\nb'])(
    'rejects %j',
    (v) => {
      expectRejected(() => assertPathspecs([v]));
    },
  );
  it('rejects the repository root spellings when a root is supplied', () => {
    const root = '/repo';
    for (const v of ['.', './', 'sub/..', '/repo', '/repo/']) {
      expect(() => assertPathspecs([v], root)).toThrow(GitMcpError);
    }
    expect(() => assertPathspecs(['sub/f'], root)).not.toThrow();
  });
});

describe('resolveRemote', () => {
  const fakeExecutor = (stdout: string, success = true): { executor: GitExecutor; execute: ReturnType<typeof vi.fn> } => {
    const execute = vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: success ? 0 : 1, success });
    return { executor: { execute } as unknown as GitExecutor, execute };
  };

  afterEach(() => {
    delete process.env['GIT_ALLOW_REMOTE_URLS'];
  });

  it('accepts a configured remote name (checked via `git remote`)', async () => {
    const { executor, execute } = fakeExecutor('origin\nupstream\n');
    await expect(resolveRemote(executor, '/repo', 'upstream')).resolves.toBe('upstream');
    expect(execute).toHaveBeenCalledWith('/repo', ['remote']);
  });

  it('rejects option-like values without asking git', async () => {
    const { executor, execute } = fakeExecutor('origin\n');
    await expect(resolveRemote(executor, '/repo', '--upload-pack=touch /tmp/x')).rejects.toBeInstanceOf(GitMcpError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects names that are not configured remotes (URLs, paths, unknown names)', async () => {
    const { executor } = fakeExecutor('origin\n');
    for (const v of ['https://evil.example/r.git', '/srv/git/r.git', 'ext::sh -c id', 'nope']) {
      await expect(resolveRemote(executor, '/repo', v)).rejects.toMatchObject({ code: ErrorCode.SECURITY_ERROR });
    }
  });

  it('allows URLs only with GIT_ALLOW_REMOTE_URLS=1, and still refuses options and helper transports', async () => {
    process.env['GIT_ALLOW_REMOTE_URLS'] = '1';
    const { executor, execute } = fakeExecutor('origin\n');
    await expect(resolveRemote(executor, '/repo', 'https://example.com/r.git')).resolves.toBe('https://example.com/r.git');
    await expect(resolveRemote(executor, '/repo', '--upload-pack=x')).rejects.toBeInstanceOf(GitMcpError);
    await expect(resolveRemote(executor, '/repo', 'ext::sh -c id')).rejects.toBeInstanceOf(GitMcpError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails clearly when git remote itself fails', async () => {
    const { executor } = fakeExecutor('', false);
    await expect(resolveRemote(executor, '/repo', 'origin')).rejects.toThrow(/remote/i);
  });
});
