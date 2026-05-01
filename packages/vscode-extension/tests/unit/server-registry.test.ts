import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerRegistry } from '../../src/server-registry';
import type { IManagedServer, ServerStatus } from '../../src/managed-server';

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------
function makeMockServer(
  id: string = 'test',
  initialStatus: ServerStatus = 'stopped'
): { server: IManagedServer; triggerStatusChange: () => void } {
  const listeners: (() => void)[] = [];
  const _status: ServerStatus = initialStatus;

  const server = {
    id,
    displayName: 'Test Server',
    get status(): ServerStatus {
      return _status;
    },
    port: undefined,
    onDidChangeStatus: (listener: () => void): { dispose: () => void } => {
      listeners.push(listener);
      return { dispose: vi.fn() };
    },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as IManagedServer;

  return {
    server,
    triggerStatusChange: () => listeners.forEach(l => l()),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ServerRegistry', () => {
  let registry: ServerRegistry;

  beforeEach(() => {
    registry = new ServerRegistry();
  });

  // ---- register -----------------------------------------------------------
  describe('register()', () => {
    it('exposes a registered server in registry.servers', () => {
      const { server } = makeMockServer('git');
      registry.register(server);
      expect(registry.servers).toHaveLength(1);
      expect(registry.servers[0]).toBe(server);
    });

    it('exposes multiple registered servers in insertion order', () => {
      const { server: s1 } = makeMockServer('git');
      const { server: s2 } = makeMockServer('other');
      registry.register(s1);
      registry.register(s2);
      expect(registry.servers).toHaveLength(2);
      expect(registry.servers[0].id).toBe('git');
      expect(registry.servers[1].id).toBe('other');
    });
  });

  // ---- start --------------------------------------------------------------
  describe('start()', () => {
    it('delegates to the adapter start()', async () => {
      const { server } = makeMockServer('git');
      registry.register(server);
      await registry.start('git');
      expect(server.start).toHaveBeenCalledOnce();
    });

    it('throws when id is not registered', async () => {
      await expect(registry.start('unknown')).rejects.toThrow(
        'Server not found: unknown'
      );
    });
  });

  // ---- stop ---------------------------------------------------------------
  describe('stop()', () => {
    it('delegates to the adapter stop()', async () => {
      const { server } = makeMockServer('git');
      registry.register(server);
      await registry.stop('git');
      expect(server.stop).toHaveBeenCalledOnce();
    });

    it('throws when id is not registered', async () => {
      await expect(registry.stop('unknown')).rejects.toThrow(
        'Server not found: unknown'
      );
    });
  });

  // ---- onDidChange --------------------------------------------------------
  describe('onDidChange', () => {
    it('fires when a registered server fires onDidChangeStatus', () => {
      const { server, triggerStatusChange } = makeMockServer('git');
      registry.register(server);
      const listener = vi.fn();
      registry.onDidChange(listener);
      triggerStatusChange();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('fires for each server independently', () => {
      const { server: s1, triggerStatusChange: fire1 } = makeMockServer('git');
      const { server: s2, triggerStatusChange: fire2 } = makeMockServer('other');
      registry.register(s1);
      registry.register(s2);
      const listener = vi.fn();
      registry.onDidChange(listener);
      fire1();
      fire2();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  // ---- stopAll ------------------------------------------------------------
  describe('stopAll()', () => {
    it('stops all running servers', async () => {
      const { server: s1 } = makeMockServer('git', 'running');
      const { server: s2 } = makeMockServer('other', 'running');
      registry.register(s1);
      registry.register(s2);
      await registry.stopAll();
      expect(s1.stop).toHaveBeenCalledOnce();
      expect(s2.stop).toHaveBeenCalledOnce();
    });

    it('does not stop servers that are not running', async () => {
      const { server } = makeMockServer('git', 'stopped');
      registry.register(server);
      await registry.stopAll();
      expect(server.stop).not.toHaveBeenCalled();
    });

    it('stops starting servers as well', async () => {
      const { server } = makeMockServer('git', 'starting');
      registry.register(server);
      await registry.stopAll();
      expect(server.stop).toHaveBeenCalledOnce();
    });
  });
});
