import { spawn } from 'node:child_process';
import path from 'node:path';

export interface SmokeStep {
  ok: boolean;
  error?: string;
  detail?: unknown;
}
export interface SmokeResult {
  runtime: { node: string; electron: string | null; sqlite: string | null; platform: string; arch: string };
  steps: Record<string, SmokeStep>;
  probe?: { ok: boolean; reason?: string; needs?: string };
  fatal?: string;
}

export const RUNNER = path.resolve(import.meta.dirname, 'smoke-runner.cjs');

/**
 * Runs smoke-runner.cjs under `binary` (Node, or a VS Code binary with `electron: true`) and returns the parsed
 * `SMOKE_RESULT` line. `env` replaces the child's environment entirely (plus ELECTRON_RUN_AS_NODE when asked).
 */
export function runSmoke(options: {
  binary: string;
  args: string[];
  electron?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ result: SmokeResult; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = { ...(options.env ?? (process.env as Record<string, string>)) };
    if (options.electron) env['ELECTRON_RUN_AS_NODE'] = '1';
    const child = spawn(options.binary, [RUNNER, ...options.args], { env, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`smoke run timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, options.timeoutMs ?? 90_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('SMOKE_RESULT '));
      if (!line) {
        reject(new Error(`no SMOKE_RESULT (exit ${String(code)})\nstdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      resolve({ result: JSON.parse(line.slice('SMOKE_RESULT '.length)) as SmokeResult, stdout, stderr });
    });
  });
}

/** Failed steps formatted for an assertion message. */
export function failures(result: SmokeResult): string {
  const failed = Object.entries(result.steps)
    .filter(([, s]) => !s.ok)
    .map(([name, s]) => `${name}: ${s.error ?? ''}`);
  return [...failed, result.fatal ?? ''].filter(Boolean).join('\n');
}
