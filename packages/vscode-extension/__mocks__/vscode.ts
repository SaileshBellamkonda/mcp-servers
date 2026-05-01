import { vi } from 'vitest';

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
// window
// ---------------------------------------------------------------------------
export const window = {
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    dispose: vi.fn(),
  })),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  createStatusBarItem: vi.fn(() => ({
    text: '' as string,
    tooltip: '' as string,
    command: undefined as string | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
};

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  })),
  workspaceFolders: undefined as
    | Array<{ uri: { fsPath: string }; name: string; index: number }>
    | undefined,
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
export const env = {
  clipboard: {
    writeText: vi.fn(),
  },
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

export class ThemeIcon {
  constructor(public readonly id: string) {}
}
