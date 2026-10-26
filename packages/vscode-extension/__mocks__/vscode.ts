import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Test controls: the mock has no real workspace, so tests drive it through `__test`.
// ---------------------------------------------------------------------------
type ConfigListener = (event: { affectsConfiguration(section: string): boolean }) => void;
type FolderListener = (event: { added: unknown[]; removed: unknown[] }) => void;

const configListeners: ConfigListener[] = [];
const folderListeners: FolderListener[] = [];
const settings = new Map<string, unknown>();
const mcpProviders = new Map<string, McpDefinitionProvider>();

interface McpDefinitionProvider {
  onDidChangeMcpServerDefinitions?: (listener: () => void) => { dispose(): void };
  provideMcpServerDefinitions(token: unknown): unknown;
  resolveMcpServerDefinition?(server: unknown, token: unknown): unknown;
}

function disposableFor<T>(list: T[], listener: T): { dispose: () => void } {
  list.push(listener);
  return {
    dispose: () => {
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
  };
}

export const __test = {
  /** Replaces the workspace folders (an empty list means "no folder open"). */
  setFolders(paths: string[]): void {
    workspace.workspaceFolders = paths.length === 0 ? undefined : paths.map((fsPath, index) => ({ uri: Uri.file(fsPath), name: `ws-${String(index)}`, index }));
  },
  /** The MCP server definition providers registered through `lm.registerMcpServerDefinitionProvider`, by id. */
  mcpProviders: (): ReadonlyMap<string, McpDefinitionProvider> => mcpProviders,
  /** Sets settings by full key, e.g. `{ 'mcpServers.git.port': 4000 }`. */
  setSettings(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) settings.set(key, value);
  },
  /** Fires onDidChangeConfiguration for the given full setting keys. */
  fireConfigChange(keys: string[]): void {
    const event = {
      affectsConfiguration: (section: string): boolean =>
        keys.some((key) => key === section || key.startsWith(`${section}.`) || section.startsWith(`${key}.`)),
    };
    [...configListeners].forEach((listener) => {
      listener(event);
    });
  },
  /** Fires onDidChangeWorkspaceFolders (set the folders first with setFolders). */
  fireFolderChange(): void {
    [...folderListeners].forEach((listener) => {
      listener({ added: [], removed: [] });
    });
  },
  listenerCounts: () => ({ config: configListeners.length, folders: folderListeners.length }),
  /** Back to a pristine workspace: no folders, no settings, no listeners. */
  reset(): void {
    settings.clear();
    configListeners.length = 0;
    folderListeners.length = 0;
    mcpProviders.clear();
    workspace.workspaceFolders = undefined;
    env.remoteName = undefined;
  },
};

// ---------------------------------------------------------------------------
// EventEmitter — mirrors vscode.EventEmitter<T>
// ---------------------------------------------------------------------------
export class EventEmitter<T = void> {
  private _listeners: ((e: T) => void)[] = [];

  get event(): (listener: (e: T) => void) => { dispose: () => void } {
    return (listener: (e: T) => void) => {
      this._listeners.push(listener);
      return {
        dispose: () => {
          this._listeners = this._listeners.filter(l => l !== listener);
        },
      };
    };
  }

  fire(data?: T): void {
    this._listeners.forEach(l => l(data as T));
  }

  dispose(): void {
    this._listeners = [];
  }
}

// ---------------------------------------------------------------------------
// Uri — the subset of vscode.Uri the extension uses
// ---------------------------------------------------------------------------
export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string
  ) {}

  static file(fsPath: string): Uri {
    return new Uri('file', fsPath.replaceAll('\\', '/'));
  }

  static parse(value: string): Uri {
    const match = /^([a-z][a-z0-9+.-]*):(?:\/\/)?(.*)$/i.exec(value);
    if (!match) throw new Error(`Invalid URI: ${value}`);
    return new Uri(match[1] ?? '', match[2] ?? '');
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return this.scheme === 'file' ? `file://${this.path}` : `${this.scheme}://${this.path}`;
  }
}

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------
export const window = {
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    dispose: vi.fn(),
  })),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  createStatusBarItem: vi.fn(() => ({
    text: '' as string,
    tooltip: '' as string,
    command: undefined as string | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  createTreeView: vi.fn((_id: string, _options: unknown) => ({ dispose: vi.fn() })),
};

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
export const workspace = {
  getConfiguration: vi.fn((section?: string) => ({
    get: vi.fn((key: string, defaultValue?: unknown) => {
      const full = section ? `${section}.${key}` : key;
      return settings.has(full) ? settings.get(full) : defaultValue;
    }),
  })),
  workspaceFolders: undefined as
    | Array<{ uri: Uri; name: string; index: number }>
    | undefined,
  workspaceFile: undefined as { toString(): string } | undefined,
  onDidChangeConfiguration: vi.fn((listener: ConfigListener) => disposableFor(configListeners, listener)),
  onDidChangeWorkspaceFolders: vi.fn((listener: FolderListener) => disposableFor(folderListeners, listener)),
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
export const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
export const env = {
  clipboard: {
    writeText: vi.fn(),
  },
  remoteName: undefined as string | undefined,
};

// ---------------------------------------------------------------------------
// lm — the MCP server definition provider API (VS Code >= 1.101)
// ---------------------------------------------------------------------------
export const lm = {
  registerMcpServerDefinitionProvider: vi.fn((id: string, provider: McpDefinitionProvider) => {
    mcpProviders.set(id, provider);
    return { dispose: () => { mcpProviders.delete(id); } };
  }),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------
export class TreeItem {
  label: string;
  collapsibleState: TreeItemCollapsibleState;
  id?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;

  constructor(
    label: string,
    collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
  ) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class McpHttpServerDefinition {
  version?: string;

  constructor(
    readonly label: string,
    public uri: Uri,
    public headers: Record<string, string> = {},
    version?: string
  ) {
    if (version !== undefined) this.version = version;
  }
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor
  ) {}
}
