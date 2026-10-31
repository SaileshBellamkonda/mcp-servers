import { Emitter, type Disposable, type Event } from './emitter';
import { formatLogData } from './logger';
import type { ModuleLoader } from './module-loader';
import type {
  ConfigReader,
  ServerDescriptor,
  ServerInfo,
  ServerInstance,
  ServerLogger,
  ServerState,
} from './server-descriptor';
import type { TokenProvider } from './token-provider';

/** Everything the adapter takes from its environment; the extension supplies the real ones, tests fakes. */
export interface AdapterDeps {
  loadModule: ModuleLoader;
  /** Milliseconds since the epoch. */
  clock: () => number;
  logger: ServerLogger;
  tokens: TokenProvider;
  config: ConfigReader;
  /** The folders servers may use right now (file-system paths). */
  workspaceFolders: () => readonly string[];
  /** Identifies the workspace for the token provider. */
  scopeKey: () => string;
}

/** What `syncWorkspace()` did. */
export type WorkspaceSyncResult = 'updated' | 'restarted' | 'became-available' | 'became-unavailable' | 'unchanged';

/** What `applyConfiguration()` and `applyTokenChange()` did. */
export type ConfigurationResult = 'restarted' | 'unchanged';

const MAX_PORT = 65535;

/**
 * Runs one embedded MCP server described by a ServerDescriptor and owns its lifecycle:
 * stopped -> starting -> running | error, `unavailable` while it cannot run here. Concurrency-safe: overlapping
 * start() calls share one promise, stop() waits for a start in flight, and a start waits for a stop in flight.
 * Free of `vscode`, so the whole state machine is unit-tested with fakes.
 */
export class EmbeddedServerAdapter implements Disposable {
  readonly id: string;
  readonly label: string;

  private state: ServerState = 'stopped';
  private reason: string | undefined;
  private instance: ServerInstance | undefined;
  /** The restart-relevant settings the running server was started with (see `ServerDescriptor.restartSettings`). */
  private startedSettings: string | undefined;
  /** The workspace scope (and therefore the token) the running server was started with. */
  private startedScope: string | undefined;
  private startedAt: number | undefined;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private token: string | undefined;

  private readonly changed = new Emitter<ServerInfo>();
  /** Fires with a snapshot of the server's info after every state change. */
  readonly onDidChangeState: Event<ServerInfo> = this.changed.event;

  constructor(
    readonly descriptor: ServerDescriptor,
    private readonly deps: AdapterDeps
  ) {
    this.id = descriptor.id;
    this.label = descriptor.label;
    if (this.missingWorkspace()) {
      this.state = 'unavailable';
      this.reason = this.workspaceReason();
    }
  }

  getInfo(): ServerInfo {
    const info: ServerInfo = { id: this.id, label: this.label, state: this.state };
    if (this.state === 'running' && this.instance) {
      info.port = this.instance.port;
      info.url = `http://${this.instance.host}:${String(this.instance.port)}/mcp`;
      if (this.startedAt !== undefined) info.startedAt = this.startedAt;
    }
    if (this.reason !== undefined && (this.state === 'error' || this.state === 'unavailable')) info.reason = this.reason;
    return info;
  }

  /** Starts the server. Idempotent: resolves immediately while running and shares the promise while starting. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.state === 'running' && !this.stopPromise) return Promise.resolve();
    const promise = this.doStart().finally(() => {
      if (this.startPromise === promise) this.startPromise = undefined;
    });
    this.startPromise = promise;
    return promise;
  }

  /** Stops the server and frees its port. Waits for a start in flight; concurrent calls share one promise. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const promise = this.doStop().finally(() => {
      if (this.stopPromise === promise) this.stopPromise = undefined;
    });
    this.stopPromise = promise;
    return promise;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Call after the workspace folders changed: re-scopes a running server in place (or restarts it when its
   * instance cannot be re-scoped), stops it when the folders it needs are gone, and updates `unavailable`.
   */
  async syncWorkspace(): Promise<WorkspaceSyncResult> {
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    if (this.missingWorkspace()) {
      if (this.state === 'unavailable') return 'unchanged';
      await this.stop();
      this.setState('unavailable', this.workspaceReason());
      return 'became-unavailable';
    }
    if (this.state === 'unavailable') {
      this.setState('stopped');
      return 'became-available';
    }
    if (this.state === 'running' && this.instance) {
      const folders = [...this.deps.workspaceFolders()];
      // The token belongs to the folder set: a different set is a different workspace scope, so the server must
      // pick up the token of the new scope (an in-place update would keep serving the old one).
      if (this.deps.scopeKey() !== this.startedScope) {
        await this.restart();
        return 'restarted';
      }
      if (this.instance.updateWorkspaceFolders) {
        await this.instance.updateWorkspaceFolders(folders);
        this.log().info(`workspace folders updated: ${folders.join(', ')}`);
        return 'updated';
      }
      await this.restart();
      return 'restarted';
    }
    return 'unchanged';
  }

  /**
   * Call after the settings changed: restarts a running server whose port, or any of the descriptor's
   * `restartSettings`, is no longer what it was started with.
   */
  async applyConfiguration(): Promise<ConfigurationResult> {
    if (this.state !== 'running') return 'unchanged';
    if (this.settingsFingerprint(this.readPort()) === this.startedSettings) return 'unchanged';
    await this.restart();
    return 'restarted';
  }

  /**
   * Call after the workspace token may have changed (another window rotated or replaced it): restarts a running
   * server that still serves the token it was started with. Waits for a start or stop in flight first, so a
   * restart that already picked up the new token is not repeated.
   */
  async applyTokenChange(): Promise<ConfigurationResult> {
    if (this.stopPromise) await this.stopPromise.catch(() => undefined);
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    if (this.state !== 'running' || this.token === undefined) return 'unchanged';
    if ((await this.deps.tokens.getToken(this.id, this.deps.scopeKey())) === this.token) return 'unchanged';
    await this.restart();
    return 'restarted';
  }

  /** The port the next start would use, or undefined when the `port` setting is invalid. */
  plannedPort(): number | undefined {
    try {
      return this.readPort();
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.stop().catch(() => undefined);
    this.changed.dispose();
  }

  // -------------------------------------------------------------------------------------------------------------
  private async doStart(): Promise<void> {
    if (this.stopPromise) await this.stopPromise.catch(() => undefined);
    if (this.missingWorkspace()) {
      this.setState('unavailable', this.workspaceReason());
      return;
    }
    this.setState('starting');
    let port: number | undefined;
    try {
      const folders = [...this.deps.workspaceFolders()];
      const availability = await this.descriptor.isAvailable({
        workspaceFolders: folders,
        config: this.deps.config,
        loadModule: this.deps.loadModule,
      });
      if (!availability.available) {
        this.setState('unavailable', availability.reason);
        this.log().warning(`unavailable: ${availability.reason}`);
        return;
      }
      port = this.readPort();
      const settings = this.settingsFingerprint(port);
      const scope = this.deps.scopeKey();
      const authToken = await this.deps.tokens.getToken(this.id, scope);
      this.token = authToken;
      const instance = await this.descriptor.activate({
        serverId: this.id,
        port,
        authToken,
        workspaceFolders: folders,
        logger: this.log(),
        config: this.deps.config,
        loadModule: this.deps.loadModule,
      });
      this.instance = instance;
      this.startedSettings = settings;
      this.startedScope = scope;
      this.startedAt = this.deps.clock();
      this.setState('running');
      this.log().info(`started on ${instance.host}:${String(instance.port)}`);
    } catch (error) {
      const reason = this.classify(error, port);
      this.setState('error', reason);
      this.log().error(`failed to start: ${reason}`);
      throw new Error(reason, { cause: error });
    }
  }

  private async doStop(): Promise<void> {
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    const instance = this.instance;
    if (!instance) return;
    this.instance = undefined;
    try {
      await instance.close();
    } catch (error) {
      const reason = `Failed to stop: ${errorMessage(error)}`;
      this.clearRuntime();
      this.setState('error', reason);
      this.log().error(reason);
      throw new Error(reason, { cause: error });
    }
    this.clearRuntime();
    this.setState('stopped');
    this.log().info('stopped');
  }

  private clearRuntime(): void {
    this.instance = undefined;
    this.startedSettings = undefined;
    this.startedScope = undefined;
    this.startedAt = undefined;
  }

  private setState(state: ServerState, reason?: string): void {
    this.state = state;
    this.reason = reason;
    this.changed.fire(this.getInfo());
  }

  private get portSetting(): string {
    return `${this.descriptor.settingsSection}.port`;
  }

  private readPort(): number {
    const value = this.deps.config.get<unknown>(this.descriptor.settingsSection, 'port', this.descriptor.defaultPort);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PORT) {
      throw new Error(`Invalid port ${JSON.stringify(value)} (change ${this.portSetting})`);
    }
    return value;
  }

  private settingsFingerprint(port: number): string {
    const { settingsSection, restartSettings = [] } = this.descriptor;
    return JSON.stringify([port, ...restartSettings.map((key) => this.deps.config.get<unknown>(settingsSection, key, null))]);
  }

  private classify(error: unknown, port: number | undefined): string {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const message = errorMessage(error);
    if (code === 'EADDRINUSE' || message.includes('EADDRINUSE')) {
      const shown = port ?? this.descriptor.defaultPort;
      return `Port ${String(shown)} is already in use (change ${this.portSetting})`;
    }
    return message;
  }

  private missingWorkspace(): boolean {
    return this.descriptor.requiresWorkspace && this.deps.workspaceFolders().length === 0;
  }

  private workspaceReason(): string {
    return `Open a folder to use the ${this.label} server`;
  }

  /** The logger handed to the server and used by the adapter (`deps.logger` writes to this server's own channel): token redacted. */
  private log(): ServerLogger {
    const write =
      (level: 'debug' | 'info' | 'warning' | 'error') =>
      (data: unknown): void => {
        let text = formatLogData(data);
        if (this.token && text.includes(this.token)) text = text.replaceAll(this.token, '***');
        this.deps.logger[level](text);
      };
    return { debug: write('debug'), info: write('info'), warning: write('warning'), error: write('error') };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
