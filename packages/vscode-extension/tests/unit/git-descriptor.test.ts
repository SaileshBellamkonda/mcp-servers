import { describe, expect, it, vi } from 'vitest';
import { gitDescriptor } from '../../src/servers/git-descriptor';
import { EmbeddedServerAdapter } from '../../src/core/embedded-server-adapter';
import { InMemoryTokenProvider } from '../../src/core/token-provider';
import type { ModuleLoader } from '../../src/core/module-loader';
import type { ActivationContext, ServerLogger } from '../../src/core/server-descriptor';

const logger: ServerLogger = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };

function fakeGitModule() {
  const instance = {
    port: 3000,
    host: '127.0.0.1',
    close: vi.fn(() => Promise.resolve()),
    updateAllowedRepositories: vi.fn(),
  };
  const activateGitServer = vi.fn(() => Promise.resolve(instance));
  const loadModule = vi.fn(() => Promise.resolve({ activateGitServer })) as unknown as ModuleLoader & ReturnType<typeof vi.fn>;
  return { instance, activateGitServer, loadModule };
}

function context(overrides: Partial<ActivationContext> = {}): ActivationContext {
  return {
    serverId: 'git',
    port: 3000,
    authToken: 'a'.repeat(64),
    workspaceFolders: ['/work/a', '/work/b'],
    logger,
    config: { get: <T>(_section: string, _key: string, fallback: T): T => fallback },
    loadModule: fakeGitModule().loadModule,
    ...overrides,
  };
}

describe('gitDescriptor', () => {
  it('describes the git server', () => {
    expect(gitDescriptor).toMatchObject({
      id: 'git',
      label: 'Git',
      settingsSection: 'mcpServers.git',
      defaultPort: 3000,
      requiresWorkspace: true,
    });
  });

  it('is available (the workspace requirement is handled by requiresWorkspace)', async () => {
    const result = await gitDescriptor.isAvailable({
      workspaceFolders: ['/x'],
      config: context().config,
      loadModule: fakeGitModule().loadModule,
    });
    expect(result).toEqual({ available: true });
  });

  it('activates through the injected loader with the options API', async () => {
    const fake = fakeGitModule();
    await gitDescriptor.activate(context({ loadModule: fake.loadModule, port: 4321 }));
    expect(fake.loadModule).toHaveBeenCalledWith('@mcp-servers/server-git/embedded');
    expect(fake.activateGitServer).toHaveBeenCalledWith({
      workspaceFolders: ['/work/a', '/work/b'],
      port: 4321,
      authToken: 'a'.repeat(64),
      logger,
    });
  });

  it('returns the bound port and host and closes the underlying server', async () => {
    const fake = fakeGitModule();
    fake.instance.port = 5555;
    const instance = await gitDescriptor.activate(context({ loadModule: fake.loadModule }));
    expect(instance).toMatchObject({ port: 5555, host: '127.0.0.1' });
    await instance.close();
    expect(fake.instance.close).toHaveBeenCalledOnce();
  });

  it('re-scopes the running server with updateAllowedRepositories instead of restarting', async () => {
    const fake = fakeGitModule();
    const instance = await gitDescriptor.activate(context({ loadModule: fake.loadModule }));
    await instance.updateWorkspaceFolders?.(['/work/c']);
    expect(fake.instance.updateAllowedRepositories).toHaveBeenCalledWith(['/work/c']);
  });

  it('propagates the listen error of the underlying server', async () => {
    const fake = fakeGitModule();
    fake.activateGitServer.mockRejectedValueOnce(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }));
    await expect(gitDescriptor.activate(context({ loadModule: fake.loadModule }))).rejects.toThrow('EADDRINUSE');
  });

  describe('inside an adapter', () => {
    function adapterWith(folders: string[], fake = fakeGitModule()) {
      const adapter = new EmbeddedServerAdapter(gitDescriptor, {
        loadModule: fake.loadModule,
        clock: () => 0,
        logger,
        tokens: new InMemoryTokenProvider(),
        config: { get: <T>(_s: string, _k: string, fallback: T): T => fallback },
        workspaceFolders: () => folders,
        scopeKey: () => 'ws',
      });
      return { adapter, fake, folders };
    }

    it('is unavailable with "Open a folder to use the Git server" without workspace folders', async () => {
      const { adapter, fake } = adapterWith([]);
      await adapter.start();
      expect(adapter.getInfo()).toMatchObject({ state: 'unavailable', reason: 'Open a folder to use the Git server' });
      expect(fake.loadModule).not.toHaveBeenCalled();
    });

    it('runs on the default port 3000 and follows folder changes without a restart', async () => {
      const { adapter, fake, folders } = adapterWith(['/work/a']);
      await adapter.start();
      expect(fake.activateGitServer).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));
      folders.push('/work/b');
      await expect(adapter.syncWorkspace()).resolves.toBe('updated');
      expect(fake.instance.updateAllowedRepositories).toHaveBeenCalledWith(['/work/a', '/work/b']);
      expect(fake.activateGitServer).toHaveBeenCalledOnce();
    });
  });
});
