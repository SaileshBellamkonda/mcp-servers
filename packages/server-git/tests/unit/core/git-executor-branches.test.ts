import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
const whichMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('which', () => ({
  default: whichMock,
}));

let GitExecutor: typeof import('../../../src/core/git-executor.js').GitExecutor;

function createFakeProcess() {
  return {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    kill: vi.fn(),
  };
}

describe('GitExecutor branch coverage', () => {
  beforeEach(async () => {
    vi.resetModules();
    execFileMock.mockReset();
    whichMock.mockReset();

    ({ GitExecutor } = await import('../../../src/core/git-executor.js'));
    (GitExecutor as unknown as { gitPath: string | null }).gitPath = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps an empty git lookup result in a GitMcpError', async () => {
    whichMock.mockResolvedValueOnce('');

    const executor = new GitExecutor();

    await expect(executor.execute('/repo', ['--version'])).rejects.toMatchObject({
      name: 'GitMcpError',
      code: 'GIT_ERROR',
      message: 'Git executable not found in PATH',
      details: {
        error: 'Git executable not found',
      },
    });
  });

  it('preserves non-Error git lookup failures as strings', async () => {
    whichMock.mockRejectedValueOnce('lookup failed');

    const executor = new GitExecutor();

    await expect(executor.execute('/repo', ['--version'])).rejects.toMatchObject({
      name: 'GitMcpError',
      code: 'GIT_ERROR',
      message: 'Git executable not found in PATH',
      details: {
        error: 'lookup failed',
      },
    });
  });

  it('wraps execution errors that do not include an exit code', async () => {
    whichMock.mockResolvedValueOnce('/usr/bin/git');

    const proc = createFakeProcess();
    execFileMock.mockImplementationOnce((_gitPath, _args, _options, callback) => {
      queueMicrotask(() => callback(new Error('spawn failed'), '', ''));
      return proc;
    });

    const executor = new GitExecutor();

    await expect(executor.execute('/repo', ['--version'])).rejects.toMatchObject({
      name: 'GitMcpError',
      code: 'GIT_ERROR',
      message: 'Failed to execute git command: spawn failed',
      details: {
        error: 'spawn failed',
      },
    });
  });

  it('prefixes every command with the hardening config and keeps the caller args after it', async () => {
    whichMock.mockResolvedValueOnce('/usr/bin/git');
    const proc = createFakeProcess();
    execFileMock.mockImplementationOnce((_gitPath, _args, _options, callback) => {
      queueMicrotask(() => callback(null, '', ''));
      return proc;
    });

    await new GitExecutor().execute('/repo', ['status', '--porcelain']);

    const args = execFileMock.mock.calls[0]![1] as string[];
    expect(args.slice(-2)).toEqual(['status', '--porcelain']);
    expect(args).toEqual(expect.arrayContaining(['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'diff.external=']));
    // Must not neutralise settings legitimate use depends on.
    const joined = args.join(' ');
    expect(joined).not.toMatch(/sshCommand|hooksPath|credential/);
  });

  it('writes stdin input to the spawned git process', async () => {
    whichMock.mockResolvedValueOnce('/usr/bin/git');

    const proc = createFakeProcess();
    execFileMock.mockImplementationOnce((_gitPath, _args, _options, callback) => {
      queueMicrotask(() => callback(null, 'hash-object output', ''));
      return proc;
    });

    const executor = new GitExecutor();
    const result = await executor.execute('/repo', ['hash-object', '--stdin'], {
      input: 'payload',
    });

    expect(proc.stdin.write).toHaveBeenCalledWith('payload');
    expect(proc.stdin.end).toHaveBeenCalled();
    expect(result).toEqual({
      stdout: 'hash-object output',
      stderr: '',
      exitCode: 0,
      success: true,
    });
  });

  it('rejects when the git command times out', async () => {
    vi.useFakeTimers();
    whichMock.mockResolvedValueOnce('/usr/bin/git');

    const proc = createFakeProcess();
    let callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

    execFileMock.mockImplementationOnce((_gitPath, _args, _options, execCallback) => {
      callback = execCallback;
      return proc;
    });

    const executor = new GitExecutor();
    const execution = executor.execute('/repo', ['status'], { timeout: 1 });

    await vi.advanceTimersByTimeAsync(1);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    callback?.(null, 'late output', '');

    await expect(execution).rejects.toMatchObject({
      name: 'GitMcpError',
      code: 'GIT_ERROR',
      message: 'Git command timed out after 1ms',
    });
  });
});