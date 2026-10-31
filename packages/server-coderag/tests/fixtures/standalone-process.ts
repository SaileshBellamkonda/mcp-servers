import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const TOKEN = `smoke-token-${'x'.repeat(32)}`;

/** Reserves a free TCP port on the loopback interface and releases it again. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => { resolve(port); });
    });
  });
}

export function externalIPv4(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return undefined;
}

export function connectOutcome(host: string, port: number): Promise<'connected' | 'refused' | 'other'> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 3000 });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('error', (err: NodeJS.ErrnoException) => { resolve(err.code === 'ECONNREFUSED' ? 'refused' : 'other'); });
    socket.once('timeout', () => { socket.destroy(); resolve('other'); });
  });
}

export interface StandaloneProcess {
  child: ChildProcess;
  /** Everything written to stderr so far. */
  stderr(): string;
  /** Resolves with the exit code (or signal) once the process ends. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Resolves when stderr matches `pattern`; rejects on timeout or early exit. */
  waitForStderr(pattern: RegExp, timeoutMs?: number): Promise<void>;
  kill(): void;
}

/**
 * Spawns `src/standalone.ts` from source with the repo's source condition and the given environment,
 * or, when `builtScript` is given, that bundled JavaScript file with plain `node` (no source condition).
 */
export function spawnStandalone(env: Record<string, string>, builtScript?: string): StandaloneProcess {
  const args = builtScript === undefined
    ? ['--conditions=@mcp-servers/source', 'src/standalone.ts']
    : [builtScript];
  const child = spawn(
    process.execPath,
    args,
    { cwd: packageRoot, env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...env }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  const listeners = new Set<() => void>();
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
    listeners.forEach((l) => { l(); });
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      listeners.forEach((l) => { l(); });
      resolve({ code, signal });
    });
  });
  return {
    child,
    stderr: () => stderr,
    exited,
    kill: () => { child.kill('SIGKILL'); },
    waitForStderr(pattern, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const check = (): void => {
          if (pattern.test(stderr)) { cleanup(); resolve(); }
          else if (child.exitCode !== null) { cleanup(); reject(new Error(`process exited before stderr matched ${String(pattern)}:\n${stderr}`)); }
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${String(pattern)}:\n${stderr}`)); }, timeoutMs);
        const cleanup = (): void => { clearTimeout(timer); listeners.delete(check); };
        listeners.add(check);
        check();
      });
    },
  };
}
