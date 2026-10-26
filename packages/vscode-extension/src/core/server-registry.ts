import { Emitter, type Disposable, type Event } from './emitter';
import type { ServerInfo } from './server-descriptor';

/** What the registry needs from a server; `EmbeddedServerAdapter` implements it. */
export interface RegistryMember extends Disposable {
  readonly id: string;
  readonly label: string;
  readonly onDidChangeState: Event<ServerInfo>;
  getInfo(): ServerInfo;
  stop(): Promise<void>;
}

/** Owns the servers of the extension and re-emits any state change as one event. */
export class ServerRegistry<T extends RegistryMember = RegistryMember> implements Disposable {
  private readonly members = new Map<string, T>();
  private readonly subscriptions: Disposable[] = [];
  private readonly changed = new Emitter<void>();

  /** Fires whenever any registered server changes state. */
  readonly onDidChange: Event<void> = this.changed.event;

  /** The registered servers in registration order. */
  get servers(): readonly T[] {
    return [...this.members.values()];
  }

  register(member: T): void {
    if (this.members.has(member.id)) throw new Error(`Server '${member.id}' is already registered`);
    this.members.set(member.id, member);
    this.subscriptions.push(
      member.onDidChangeState(() => {
        this.changed.fire();
      })
    );
  }

  get(id: string): T | undefined {
    return this.members.get(id);
  }

  /** Stops every server, attempting all of them; rejects with an AggregateError listing the failures. */
  async stopAll(): Promise<void> {
    const results = await Promise.allSettled([...this.members.values()].map((member) => member.stop()));
    const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : []));
    if (errors.length > 0) throw new AggregateError(errors, `Failed to stop ${String(errors.length)} MCP server(s)`);
  }

  dispose(): void {
    this.subscriptions.splice(0).forEach((subscription) => {
      subscription.dispose();
    });
    this.changed.dispose();
    this.members.forEach((member) => {
      member.dispose();
    });
  }
}
