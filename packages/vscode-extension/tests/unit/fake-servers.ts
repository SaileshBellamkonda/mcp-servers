import { vi } from 'vitest';
import { EmbeddedServerAdapter } from '../../src/core/embedded-server-adapter';
import { ServerRegistry } from '../../src/core/server-registry';
import { InMemoryTokenProvider } from '../../src/core/token-provider';
import type { ServerDescriptor, ServerInstance, ServerState } from '../../src/core/server-descriptor';

export interface FakeServer {
  adapter: EmbeddedServerAdapter;
  descriptor: ServerDescriptor;
  activate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/** Builds a real adapter over a fake descriptor and brings it to `state`. */
export async function makeServer(id: string, state: ServerState, port = 3000, label = id.toUpperCase()): Promise<FakeServer> {
  const close = vi.fn(() => Promise.resolve());
  const activate = vi.fn((): Promise<ServerInstance> => Promise.resolve({ port, host: '127.0.0.1', close }));
  const descriptor: ServerDescriptor = {
    id,
    label,
    settingsSection: `mcpServers.${id}`,
    defaultPort: port,
    requiresWorkspace: false,
    isAvailable: () => (state === 'unavailable' ? { available: false, reason: `${label} cannot run here` } : { available: true }),
    activate,
  };
  if (state === 'error') activate.mockRejectedValue(new Error(`${label} exploded`));
  if (state === 'starting') activate.mockReturnValue(new Promise<ServerInstance>(() => undefined));
  const adapter = new EmbeddedServerAdapter(descriptor, {
    loadModule: vi.fn() as never,
    clock: () => 0,
    logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    tokens: new InMemoryTokenProvider(),
    config: { get: <T>(_section: string, _key: string, fallback: T): T => fallback },
    workspaceFolders: () => ['/work'],
    scopeKey: () => 'ws',
  });
  if (state === 'running' || state === 'error' || state === 'unavailable') await adapter.start().catch(() => undefined);
  if (state === 'starting') void adapter.start().catch(() => undefined);
  if (state === 'starting') await new Promise((resolve) => setImmediate(resolve));
  return { adapter, descriptor, activate, close };
}

export async function makeRegistry(
  specs: [id: string, state: ServerState, port?: number][]
): Promise<{ registry: ServerRegistry<EmbeddedServerAdapter>; servers: Record<string, FakeServer> }> {
  const registry = new ServerRegistry<EmbeddedServerAdapter>();
  const servers: Record<string, FakeServer> = {};
  for (const [id, state, port] of specs) {
    const server = await makeServer(id, state, port);
    registry.register(server.adapter);
    servers[id] = server;
  }
  return { registry, servers };
}
