import type { ModuleLoader } from './module-loader';

export type ServerState = 'stopped' | 'starting' | 'running' | 'error' | 'unavailable';

/** Receives diagnostics of a server and of its adapter. Never receives tokens. */
export interface ServerLogger {
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

/** Reads one setting: `get('mcpServers.git', 'port', 3000)` is `getConfiguration('mcpServers.git').get('port', 3000)`. */
export interface ConfigReader {
  get<T>(section: string, key: string, fallback: T): T;
}

export type Availability = { available: true } | { available: false; reason: string };

export interface AvailabilityContext {
  workspaceFolders: readonly string[];
  config: ConfigReader;
  loadModule: ModuleLoader;
}

export interface ActivationContext {
  serverId: string;
  /** The port to bind (0 picks a free one). */
  port: number;
  /** The bearer token the server must require. */
  authToken: string;
  workspaceFolders: string[];
  logger: ServerLogger;
  config: ConfigReader;
  loadModule: ModuleLoader;
}

/** A running embedded server, as the adapter sees it. */
export interface ServerInstance {
  /** The port actually bound. */
  port: number;
  host: string;
  close(): Promise<void>;
  /** Re-scopes the running server to new workspace folders; when absent the adapter restarts the server instead. */
  updateWorkspaceFolders?(folders: string[]): Promise<void>;
}

/** Everything the extension needs to know about one embedded server; the adapter, tree and commands are generic. */
export interface ServerDescriptor {
  /** Stable id used in commands, tokens and messages, e.g. `git`. */
  id: string;
  /** Short name: shown as "<label> server" in messages and as the tree label. */
  label: string;
  /** Settings section holding `port` and `autoStart`, e.g. `mcpServers.git`. */
  settingsSection: string;
  defaultPort: number;
  /** When true the server is `unavailable` while no workspace folder is open. */
  requiresWorkspace: boolean;
  /** Probes whether the server can run here (modules, platform, ...). Called before every start. */
  isAvailable(context: AvailabilityContext): Availability | Promise<Availability>;
  /** Starts the server; rejects with the real listen/startup error. */
  activate(context: ActivationContext): Promise<ServerInstance>;
}

/** What the tree, status bar and commands may show about a server. Never contains a token. */
export interface ServerInfo {
  id: string;
  label: string;
  state: ServerState;
  /** The bound port; only while running. */
  port?: number;
  /** `http://<host>:<port>/mcp`; only while running. */
  url?: string;
  /** Why the server is in `error` or `unavailable`. */
  reason?: string;
  /** When the running server started (milliseconds since the epoch, from the adapter's clock). */
  startedAt?: number;
}
