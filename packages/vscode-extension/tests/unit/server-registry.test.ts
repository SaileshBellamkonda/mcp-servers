import { describe, expect, it, vi } from 'vitest';
import { ServerRegistry, type RegistryMember } from '../../src/core/server-registry';
import { Emitter } from '../../src/core/emitter';
import type { ServerInfo } from '../../src/core/server-descriptor';

function fakeMember(id: string, state: ServerInfo['state'] = 'stopped'): RegistryMember & { emitter: Emitter<ServerInfo>; stop: ReturnType<typeof vi.fn> } {
  const emitter = new Emitter<ServerInfo>();
  const member = {
    id,
    label: id,
    emitter,
    onDidChangeState: emitter.event,
    getInfo: (): ServerInfo => ({ id, label: id, state }),
    stop: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
  return member as never;
}

describe('ServerRegistry', () => {
  it('lists registered servers in order and finds them by id', () => {
    const registry = new ServerRegistry<RegistryMember>();
    const git = fakeMember('git');
    const other = fakeMember('other');
    registry.register(git);
    registry.register(other);
    expect(registry.servers).toEqual([git, other]);
    expect(registry.get('other')).toBe(other);
    expect(registry.get('missing')).toBeUndefined();
  });

  it('refuses a second server with the same id', () => {
    const registry = new ServerRegistry<RegistryMember>();
    registry.register(fakeMember('git'));
    expect(() => {
      registry.register(fakeMember('git'));
    }).toThrow('already registered');
  });

  it('fires onDidChange whenever any server changes state', () => {
    const registry = new ServerRegistry<RegistryMember>();
    const git = fakeMember('git');
    const other = fakeMember('other');
    registry.register(git);
    registry.register(other);
    const listener = vi.fn();
    registry.onDidChange(listener);
    git.emitter.fire(git.getInfo());
    other.emitter.fire(other.getInfo());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stopAll() stops every server, attempts all of them even when one fails, then reports the failures', async () => {
    const registry = new ServerRegistry<RegistryMember>();
    const a = fakeMember('a');
    const b = fakeMember('b');
    const c = fakeMember('c');
    b.stop.mockRejectedValueOnce(new Error('b failed'));
    [a, b, c].forEach((m) => {
      registry.register(m);
    });
    const failure = await registry.stopAll().catch((e: unknown) => e as AggregateError);
    expect(a.stop).toHaveBeenCalledOnce();
    expect(b.stop).toHaveBeenCalledOnce();
    expect(c.stop).toHaveBeenCalledOnce();
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((e: Error) => e.message)).toEqual(['b failed']);
  });

  it('stopAll() resolves when every stop succeeds', async () => {
    const registry = new ServerRegistry<RegistryMember>();
    registry.register(fakeMember('a'));
    await expect(registry.stopAll()).resolves.toBeUndefined();
  });

  it('dispose() disposes the members and stops forwarding events', () => {
    const registry = new ServerRegistry<RegistryMember>();
    const git = fakeMember('git');
    registry.register(git);
    const listener = vi.fn();
    registry.onDidChange(listener);
    registry.dispose();
    git.emitter.fire(git.getInfo());
    expect(git.dispose).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });
});
