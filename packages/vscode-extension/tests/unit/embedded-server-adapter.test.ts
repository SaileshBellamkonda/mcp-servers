import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EmbeddedServerAdapter } from '../../src/core/embedded-server-adapter';
import { InMemoryTokenProvider } from '../../src/core/token-provider';
import { callArg } from './call-args';
import type {
  ActivationContext,
  Availability,
  ServerDescriptor,
  ServerInfo,
  ServerInstance,
  ServerLogger,
} from '../../src/core/server-descriptor';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
interface FakeInstance extends ServerInstance {
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  updateWorkspaceFolders: ReturnType<typeof vi.fn<(folders: string[]) => Promise<void>>>;
}

function fakeInstance(port = 3000, withUpdate = true): FakeInstance {
  const instance = {
    port,
    host: '127.0.0.1',
    close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    updateWorkspaceFolders: vi.fn<(folders: string[]) => Promise<void>>(() => Promise.resolve()),
  };
  if (!withUpdate) delete (instance as Partial<typeof instance>).updateWorkspaceFolders;
  return instance;
}

/** Stable tokens like the real provider, plus a way to change them as another window's rotate would. */
class RotatingTokens extends InMemoryTokenProvider {
  private generation = 0;
  rotate(): void {
    this.generation++;
  }
  override async getToken(serverId: string, scopeKey: string): Promise<string> {
    return createHash('sha256').update(`${await super.getToken(serverId, scopeKey)}-${String(this.generation)}`).digest('hex');
  }
}

interface Harness {
  adapter: EmbeddedServerAdapter;
  descriptor: ServerDescriptor & {
    activate: ReturnType<typeof vi.fn<(context: ActivationContext) => Promise<ServerInstance>>>;
    isAvailable: ReturnType<typeof vi.fn<() => Availability | Promise<Availability>>>;
  };
  folders: string[];
  settings: Record<string, unknown>;
  logs: { level: string; data: unknown }[];
  states: ServerInfo[];
  tokens: RotatingTokens;
  instances: FakeInstance[];
}

function makeHarness(
  options: {
    folders?: string[];
    withUpdate?: boolean;
    settings?: Record<string, unknown>;
    restartSettings?: string[];
    scopeOf?: (folders: string[]) => string;
  } = {}
): Harness {
  const folders = options.folders ?? ['/work/a'];
  const settings: Record<string, unknown> = options.settings ?? {};
  const instances: FakeInstance[] = [];
  const logs: { level: string; data: unknown }[] = [];
  const logger: ServerLogger = {
    info: (data) => logs.push({ level: 'info', data }),
    warning: (data) => logs.push({ level: 'warning', data }),
    error: (data) => logs.push({ level: 'error', data }),
  };
  const descriptor = {
    id: 'fake',
    label: 'Fake',
    settingsSection: 'mcpServers.fake',
    defaultPort: 3999,
    requiresWorkspace: true,
    ...(options.restartSettings && { restartSettings: options.restartSettings }),
    isAvailable: vi.fn<() => Availability | Promise<Availability>>(() => ({ available: true })),
    activate: vi.fn<(context: ActivationContext) => Promise<ServerInstance>>(() => {
      const instance = fakeInstance(3999 + instances.length, options.withUpdate ?? true);
      instances.push(instance);
      return Promise.resolve(instance);
    }),
  };
  const tokens = new RotatingTokens();
  const adapter = new EmbeddedServerAdapter(descriptor, {
    loadModule: vi.fn() as never,
    clock: () => 1_700_000_000_000,
    logger,
    tokens,
    config: {
      get: <T>(section: string, key: string, fallback: T): T => {
        const id = `${section}.${key}`;
        return Object.hasOwn(settings, id) ? (settings[id] as T) : fallback;
      },
    },
    workspaceFolders: () => folders,
    scopeKey: () => options.scopeOf?.(folders) ?? 'ws',
  });
  const states: ServerInfo[] = [];
  adapter.onDidChangeState((info) => states.push(info));
  return { adapter, descriptor, folders, settings, logs, states, tokens, instances };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
describe('EmbeddedServerAdapter', () => {
  describe('initial state', () => {
    it('is stopped with the descriptor identity and no port or url', () => {
      const { adapter } = makeHarness();
      expect(adapter.id).toBe('fake');
      expect(adapter.label).toBe('Fake');
      expect(adapter.getInfo()).toEqual({ id: 'fake', label: 'Fake', state: 'stopped' });
    });

    it('is unavailable with a reason when the server requires a workspace and none is open', () => {
      const { adapter } = makeHarness({ folders: [] });
      expect(adapter.getInfo()).toMatchObject({ state: 'unavailable', reason: 'Open a folder to use the Fake server' });
    });

    it('exposes the descriptor', () => {
      const { adapter, descriptor } = makeHarness();
      expect(adapter.descriptor).toBe(descriptor);
    });
  });

  describe('start()', () => {
    it('goes stopped -> starting -> running and reports port, url and start time', async () => {
      const h = makeHarness();
      await h.adapter.start();
      expect(h.states.map((s) => s.state)).toEqual(['starting', 'running']);
      expect(h.adapter.getInfo()).toEqual({
        id: 'fake',
        label: 'Fake',
        state: 'running',
        port: 3999,
        url: 'http://127.0.0.1:3999/mcp',
        startedAt: 1_700_000_000_000,
      });
    });

    it('activates with the configured port, a copy of the folders, a 32-byte hex token and the shared services', async () => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': 4100 }, folders: ['/work/a', '/work/b'] });
      await h.adapter.start();
      const context = h.descriptor.activate.mock.calls[0]?.[0];
      expect(context).toMatchObject({ serverId: 'fake', port: 4100, workspaceFolders: ['/work/a', '/work/b'] });
      expect(context?.authToken).toMatch(/^[0-9a-f]{64}$/);
      expect(context?.workspaceFolders).not.toBe(h.folders);
      expect(typeof context?.loadModule).toBe('function');
      expect(context?.config.get('mcpServers.fake', 'port', 1)).toBe(4100);
    });

    it('uses the descriptor default port when the setting is absent', async () => {
      const h = makeHarness();
      await h.adapter.start();
      expect(h.descriptor.activate.mock.calls[0]?.[0].port).toBe(3999);
    });

    it.each([['abc'], [-1], [70000], [1.5], [null]])('rejects the invalid port %j with the setting name', async (value) => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': value } });
      await expect(h.adapter.start()).rejects.toThrow('Invalid port');
      expect(h.adapter.getInfo()).toMatchObject({ state: 'error' });
      expect(h.adapter.getInfo().reason).toContain('mcpServers.fake.port');
      expect(h.descriptor.activate).not.toHaveBeenCalled();
    });

    it('a second start() while starting returns the same promise and activates once', async () => {
      const h = makeHarness();
      const gate = deferred<ServerInstance>();
      h.descriptor.activate.mockReturnValueOnce(gate.promise);
      const first = h.adapter.start();
      const second = h.adapter.start();
      expect(second).toBe(first);
      await tick();
      expect(h.adapter.getInfo().state).toBe('starting');
      gate.resolve(fakeInstance());
      await Promise.all([first, second]);
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
      expect(h.adapter.getInfo().state).toBe('running');
    });

    it('start() while running is a no-op', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.states.length = 0;
      await h.adapter.start();
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
      expect(h.states).toEqual([]);
    });

    it('concurrent callers of a failing start all see the same rejection', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockRejectedValueOnce(new Error('nope'));
      const results = await Promise.allSettled([h.adapter.start(), h.adapter.start()]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      const [a, b] = results as PromiseRejectedResult[];
      expect(a?.reason).toBe(b?.reason);
    });

    it('is unavailable (without starting or throwing) when a workspace is required and none is open', async () => {
      const h = makeHarness({ folders: [] });
      await h.adapter.start();
      expect(h.adapter.getInfo()).toMatchObject({ state: 'unavailable', reason: 'Open a folder to use the Fake server' });
      expect(h.descriptor.activate).not.toHaveBeenCalled();
      expect(h.descriptor.isAvailable).not.toHaveBeenCalled();
    });

    it('is unavailable with the probe reason when isAvailable says so, and can start once it says yes', async () => {
      const h = makeHarness();
      h.descriptor.isAvailable.mockResolvedValueOnce({ available: false, reason: 'needs VS Code >= 1.103' });
      await h.adapter.start();
      expect(h.adapter.getInfo()).toMatchObject({ state: 'unavailable', reason: 'needs VS Code >= 1.103' });
      expect(h.descriptor.activate).not.toHaveBeenCalled();
      await h.adapter.start();
      expect(h.adapter.getInfo().state).toBe('running');
    });

    it('passes the workspace folders to the availability probe', async () => {
      const h = makeHarness({ folders: ['/x'] });
      await h.adapter.start();
      expect(h.descriptor.isAvailable).toHaveBeenCalledWith(expect.objectContaining({ workspaceFolders: ['/x'] }));
    });

    it('a throwing probe becomes an error with its message', async () => {
      const h = makeHarness();
      h.descriptor.isAvailable.mockImplementationOnce(() => {
        throw new Error('probe exploded');
      });
      await expect(h.adapter.start()).rejects.toThrow('probe exploded');
      expect(h.adapter.getInfo()).toMatchObject({ state: 'error', reason: 'probe exploded' });
    });
  });

  describe('error classification', () => {
    it('EADDRINUSE (error code) names the port and the setting', async () => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': 3000 } });
      h.descriptor.activate.mockRejectedValueOnce(Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:3000'), { code: 'EADDRINUSE' }));
      await expect(h.adapter.start()).rejects.toThrow('Port 3000 is already in use (change mcpServers.fake.port)');
      expect(h.adapter.getInfo()).toMatchObject({
        state: 'error',
        reason: 'Port 3000 is already in use (change mcpServers.fake.port)',
      });
      expect(h.adapter.getInfo().port).toBeUndefined();
    });

    it('EADDRINUSE that only appears in the message is recognised too', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockRejectedValueOnce(new Error('listen EADDRINUSE :::3999'));
      await expect(h.adapter.start()).rejects.toThrow('Port 3999 is already in use');
    });

    it('any other error keeps its real message', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockRejectedValueOnce(new Error('listen EACCES: permission denied 127.0.0.1:80'));
      await expect(h.adapter.start()).rejects.toThrow('listen EACCES: permission denied 127.0.0.1:80');
      expect(h.adapter.getInfo().reason).toBe('listen EACCES: permission denied 127.0.0.1:80');
      expect(h.adapter.getInfo().reason).not.toContain('in use');
    });

    it('a rejection that is not an Error is stringified', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockRejectedValueOnce('plain failure');
      await expect(h.adapter.start()).rejects.toThrow('plain failure');
    });

    it('keeps the original error as the cause and logs the failure', async () => {
      const h = makeHarness();
      const original = new Error('kaboom');
      h.descriptor.activate.mockRejectedValueOnce(original);
      const failure = (await h.adapter.start().catch((e: unknown) => e)) as Error;
      expect(failure.cause).toBe(original);
      expect(h.logs.some((l) => l.level === 'error' && String(l.data).includes('kaboom'))).toBe(true);
    });

    it('can be retried after an error and clears the reason', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockRejectedValueOnce(new Error('first try'));
      await expect(h.adapter.start()).rejects.toThrow('first try');
      await h.adapter.start();
      expect(h.adapter.getInfo().state).toBe('running');
      expect(h.adapter.getInfo().reason).toBeUndefined();
    });
  });

  describe('stop()', () => {
    it('closes the instance, frees the port and ends stopped', async () => {
      const h = makeHarness();
      await h.adapter.start();
      await h.adapter.stop();
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
      expect(h.adapter.getInfo()).toEqual({ id: 'fake', label: 'Fake', state: 'stopped' });
    });

    it('reports stopped only after close() resolved', async () => {
      const h = makeHarness();
      await h.adapter.start();
      const gate = deferred<void>();
      h.instances[0]?.close.mockReturnValueOnce(gate.promise);
      const stopping = h.adapter.stop();
      await tick();
      expect(h.adapter.getInfo().state).toBe('running');
      gate.resolve();
      await stopping;
      expect(h.adapter.getInfo().state).toBe('stopped');
    });

    it('is a no-op when stopped', async () => {
      const h = makeHarness();
      await h.adapter.stop();
      expect(h.states).toEqual([]);
    });

    it('concurrent stops close once and share the promise', async () => {
      const h = makeHarness();
      await h.adapter.start();
      const first = h.adapter.stop();
      const second = h.adapter.stop();
      expect(second).toBe(first);
      await first;
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
    });

    it('a stop() issued while starting waits for the start and then closes the server', async () => {
      const h = makeHarness();
      const gate = deferred<ServerInstance>();
      const instance = fakeInstance();
      h.descriptor.activate.mockReturnValueOnce(gate.promise);
      const starting = h.adapter.start();
      await tick();
      const stopping = h.adapter.stop();
      gate.resolve(instance);
      await Promise.all([starting, stopping]);
      expect(instance.close).toHaveBeenCalledOnce();
      expect(h.adapter.getInfo().state).toBe('stopped');
    });

    it('a stop() issued while starting does not throw when that start fails', async () => {
      const h = makeHarness();
      const gate = deferred<ServerInstance>();
      h.descriptor.activate.mockReturnValueOnce(gate.promise);
      const starting = h.adapter.start();
      const stopping = h.adapter.stop();
      gate.reject(new Error('late failure'));
      await expect(starting).rejects.toThrow('late failure');
      await expect(stopping).resolves.toBeUndefined();
    });

    it('a close() failure ends in error with the real reason, drops the instance and rejects', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.instances[0]?.close.mockRejectedValueOnce(new Error('socket stuck'));
      await expect(h.adapter.stop()).rejects.toThrow('socket stuck');
      expect(h.adapter.getInfo()).toMatchObject({ state: 'error', reason: 'Failed to stop: socket stuck' });
      expect(h.adapter.getInfo().port).toBeUndefined();
      await h.adapter.start();
      expect(h.adapter.getInfo().state).toBe('running');
      expect(h.instances).toHaveLength(2);
    });

    it('a start() issued while stopping waits for the stop, then starts a fresh server', async () => {
      const h = makeHarness();
      await h.adapter.start();
      const gate = deferred<void>();
      h.instances[0]?.close.mockReturnValueOnce(gate.promise);
      const stopping = h.adapter.stop();
      const starting = h.adapter.start();
      await tick();
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
      gate.resolve();
      await Promise.all([stopping, starting]);
      expect(h.descriptor.activate).toHaveBeenCalledTimes(2);
      expect(h.adapter.getInfo().state).toBe('running');
    });
  });

  describe('restart()', () => {
    it('stops and starts again, reusing the token of the session', async () => {
      const h = makeHarness();
      await h.adapter.start();
      await h.adapter.restart();
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
      expect(h.descriptor.activate).toHaveBeenCalledTimes(2);
      const tokens = h.descriptor.activate.mock.calls.map((c) => c[0].authToken);
      expect(tokens[0]).toBe(tokens[1]);
      expect(h.adapter.getInfo().state).toBe('running');
    });

    it('starts a stopped server', async () => {
      const h = makeHarness();
      await h.adapter.restart();
      expect(h.adapter.getInfo().state).toBe('running');
    });

    it('rejects with the real reason when the new start fails', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.descriptor.activate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      await expect(h.adapter.restart()).rejects.toThrow('already in use');
      expect(h.adapter.getInfo().state).toBe('error');
    });
  });

  describe('syncWorkspace()', () => {
    it('re-scopes a running server in place when the instance supports it', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.folders.splice(0, h.folders.length, '/work/a', '/work/b');
      await expect(h.adapter.syncWorkspace()).resolves.toBe('updated');
      expect(h.instances[0]?.updateWorkspaceFolders).toHaveBeenCalledWith(['/work/a', '/work/b']);
      expect(h.instances[0]?.close).not.toHaveBeenCalled();
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
    });

    it('restarts a running server whose instance cannot be re-scoped', async () => {
      const h = makeHarness({ withUpdate: false });
      await h.adapter.start();
      h.folders.splice(0, h.folders.length, '/work/b');
      await expect(h.adapter.syncWorkspace()).resolves.toBe('restarted');
      expect(h.descriptor.activate).toHaveBeenCalledTimes(2);
      expect(h.descriptor.activate.mock.calls[1]?.[0].workspaceFolders).toEqual(['/work/b']);
    });

    it('restarts instead of re-scoping when the folder set changes the workspace scope (the token follows the scope)', async () => {
      const h = makeHarness({ scopeOf: (folders) => folders.join('|') });
      await h.adapter.start();
      const first = callArg<ActivationContext>(h.descriptor.activate).authToken;
      h.folders.splice(0, h.folders.length, '/work/a', '/work/b');
      await expect(h.adapter.syncWorkspace()).resolves.toBe('restarted');
      expect(h.instances[0]?.updateWorkspaceFolders).not.toHaveBeenCalled();
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
      const second = callArg<ActivationContext>(h.descriptor.activate, 1).authToken;
      expect(second).not.toBe(first);
      expect(h.descriptor.activate.mock.calls[1]?.[0].workspaceFolders).toEqual(['/work/a', '/work/b']);
    });

    it('stops a running server and turns unavailable when the last folder is closed', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.folders.length = 0;
      await expect(h.adapter.syncWorkspace()).resolves.toBe('became-unavailable');
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
      expect(h.adapter.getInfo()).toMatchObject({ state: 'unavailable', reason: 'Open a folder to use the Fake server' });
    });

    it('turns an unavailable server stopped (not started) when a folder is opened', async () => {
      const h = makeHarness({ folders: [] });
      h.folders.push('/work/a');
      await expect(h.adapter.syncWorkspace()).resolves.toBe('became-available');
      expect(h.adapter.getInfo().state).toBe('stopped');
      expect(h.descriptor.activate).not.toHaveBeenCalled();
    });

    it('turns a stopped server unavailable when the folders disappear', async () => {
      const h = makeHarness();
      h.folders.length = 0;
      await expect(h.adapter.syncWorkspace()).resolves.toBe('became-unavailable');
      expect(h.adapter.getInfo().state).toBe('unavailable');
    });

    it('changes nothing for a stopped server with folders and for an errored server', async () => {
      const h = makeHarness();
      await expect(h.adapter.syncWorkspace()).resolves.toBe('unchanged');
      h.descriptor.activate.mockRejectedValueOnce(new Error('bad'));
      await h.adapter.start().catch(() => undefined);
      await expect(h.adapter.syncWorkspace()).resolves.toBe('unchanged');
      expect(h.adapter.getInfo().state).toBe('error');
    });

    it('rejects when the in-place update fails and leaves the server running', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.instances[0]?.updateWorkspaceFolders.mockRejectedValueOnce(new Error('cannot rescope'));
      await expect(h.adapter.syncWorkspace()).rejects.toThrow('cannot rescope');
      expect(h.adapter.getInfo().state).toBe('running');
    });
  });

  describe('applyConfiguration()', () => {
    it('restarts a running server when the configured port changed', async () => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': 4000 } });
      await h.adapter.start();
      h.settings['mcpServers.fake.port'] = 4001;
      await expect(h.adapter.applyConfiguration()).resolves.toBe('restarted');
      expect(h.descriptor.activate.mock.calls[1]?.[0].port).toBe(4001);
    });

    it('does nothing when the port is unchanged or the server is not running', async () => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': 4000 } });
      await expect(h.adapter.applyConfiguration()).resolves.toBe('unchanged');
      await h.adapter.start();
      await expect(h.adapter.applyConfiguration()).resolves.toBe('unchanged');
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
    });

    it('compares against the requested port, so port 0 (ephemeral) does not restart forever', async () => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': 0 } });
      await h.adapter.start();
      await expect(h.adapter.applyConfiguration()).resolves.toBe('unchanged');
    });

    it('restarts when a setting listed in restartSettings changed, comparing values (arrays too)', async () => {
      const h = makeHarness({ restartSettings: ['model', 'globs'], settings: { 'mcpServers.fake.globs': ['a'] } });
      await h.adapter.start();
      h.settings['mcpServers.fake.globs'] = ['a'];
      await expect(h.adapter.applyConfiguration()).resolves.toBe('unchanged');
      h.settings['mcpServers.fake.model'] = 'm2';
      await expect(h.adapter.applyConfiguration()).resolves.toBe('restarted');
      h.settings['mcpServers.fake.globs'] = ['a', 'b'];
      await expect(h.adapter.applyConfiguration()).resolves.toBe('restarted');
      expect(h.descriptor.activate).toHaveBeenCalledTimes(3);
    });

    it('ignores settings that are not listed in restartSettings', async () => {
      const h = makeHarness({ restartSettings: ['model'] });
      await h.adapter.start();
      h.settings['mcpServers.fake.autoStart'] = false;
      h.settings['mcpServers.fake.other'] = 1;
      await expect(h.adapter.applyConfiguration()).resolves.toBe('unchanged');
    });

    it('rejects with the real reason when the restart fails', async () => {
      const h = makeHarness({ settings: { 'mcpServers.fake.port': 4000 } });
      await h.adapter.start();
      h.settings['mcpServers.fake.port'] = 4001;
      h.descriptor.activate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EADDRINUSE' }));
      await expect(h.adapter.applyConfiguration()).rejects.toThrow('Port 4001 is already in use');
    });
  });

  describe('applyTokenChange()', () => {
    const authToken = (h: Harness, call: number): unknown => h.descriptor.activate.mock.calls[call]?.[0].authToken;

    it('restarts a running server whose token is no longer the one the workspace has (changed in another window)', async () => {
      const h = makeHarness();
      await h.adapter.start();
      const original = authToken(h, 0);
      h.tokens.rotate();
      await expect(h.adapter.applyTokenChange()).resolves.toBe('restarted');
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
      expect(h.descriptor.activate).toHaveBeenCalledTimes(2);
      expect(authToken(h, 1)).not.toBe(original);
    });

    it('does nothing while the server already runs with the current token', async () => {
      const h = makeHarness();
      await h.adapter.start();
      await expect(h.adapter.applyTokenChange()).resolves.toBe('unchanged');
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
    });

    it('does nothing to a server that is not running', async () => {
      const h = makeHarness();
      await expect(h.adapter.applyTokenChange()).resolves.toBe('unchanged');
      await h.adapter.start();
      await h.adapter.stop();
      h.tokens.rotate();
      await expect(h.adapter.applyTokenChange()).resolves.toBe('unchanged');
      expect(h.descriptor.activate).toHaveBeenCalledOnce();
    });

    it('waits for a restart in flight and then finds the token current (no second restart)', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.tokens.rotate();
      const restarting = h.adapter.restart();
      await expect(h.adapter.applyTokenChange()).resolves.toBe('unchanged');
      await restarting;
      expect(h.descriptor.activate).toHaveBeenCalledTimes(2);
    });
  });

  describe('plannedPort()', () => {
    it('is the configured port, or the descriptor default', () => {
      expect(makeHarness().adapter.plannedPort()).toBe(3999);
      expect(makeHarness({ settings: { 'mcpServers.fake.port': 4100 } }).adapter.plannedPort()).toBe(4100);
    });

    it('is undefined for an invalid port instead of throwing', () => {
      expect(makeHarness({ settings: { 'mcpServers.fake.port': 'x' } }).adapter.plannedPort()).toBeUndefined();
      expect(makeHarness({ settings: { 'mcpServers.fake.port': 70000 } }).adapter.plannedPort()).toBeUndefined();
    });
  });

  describe('events, logging and disposal', () => {
    it('emits a ServerInfo snapshot for every state change', async () => {
      const h = makeHarness();
      await h.adapter.start();
      await h.adapter.stop();
      expect(h.states.map((s) => s.state)).toEqual(['starting', 'running', 'stopped']);
      expect(h.states[1]).toMatchObject({ port: 3999, url: 'http://127.0.0.1:3999/mcp' });
    });

    it('never exposes the token through getInfo() or events', async () => {
      const h = makeHarness();
      await h.adapter.start();
      const token = h.descriptor.activate.mock.calls[0]?.[0].authToken ?? '';
      expect(token).not.toBe('');
      expect(JSON.stringify([h.adapter.getInfo(), h.states])).not.toContain(token);
    });

    it('never logs the token, even when the server hands it to the logger', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockImplementationOnce((context) => {
        context.logger.info(`Authorization: Bearer ${context.authToken}`);
        context.logger.warning({ header: `Bearer ${context.authToken}` });
        context.logger.error(new Error(`bad ${context.authToken}`));
        return Promise.resolve(fakeInstance());
      });
      await h.adapter.start();
      const token = (await h.tokens.getToken('fake', 'ws'));
      const everything = h.logs.map((l) => (l.data instanceof Error ? l.data.message : JSON.stringify(l.data))).join('\n');
      expect(everything).not.toContain(token);
      expect(everything).toContain('Bearer ***');
    });

    it('prefixes the diagnostics of the server with its id', async () => {
      const h = makeHarness();
      h.descriptor.activate.mockImplementationOnce((context) => {
        context.logger.info('listening');
        return Promise.resolve(fakeInstance());
      });
      await h.adapter.start();
      expect(h.logs.some((l) => l.data === '[fake] listening')).toBe(true);
    });

    it('dispose() stops a running server and silences the events', async () => {
      const h = makeHarness();
      await h.adapter.start();
      h.states.length = 0;
      h.adapter.dispose();
      await h.adapter.stop();
      expect(h.instances[0]?.close).toHaveBeenCalledOnce();
      expect(h.states).toEqual([]);
    });

    it('a listener that throws does not fail the start', async () => {
      const h = makeHarness();
      h.adapter.onDidChangeState(() => {
        throw new Error('listener bug');
      });
      await expect(h.adapter.start()).resolves.toBeUndefined();
      expect(h.adapter.getInfo().state).toBe('running');
    });
  });
});
