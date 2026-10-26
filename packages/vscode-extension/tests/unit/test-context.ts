import * as vscode from 'vscode';
import type { SecretStore } from '../../src/core/token-provider';

/** An in-memory stand-in for `context.secrets` with the change event of the real one. */
export class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  private readonly listeners: ((event: { key: string }) => void)[] = [];

  readonly onDidChange = (listener: (event: { key: string }) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners.splice(this.listeners.indexOf(listener), 1);
      },
    };
  };

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }
  store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.listeners.forEach((listener) => {
      listener({ key });
    });
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.values.delete(key);
    this.listeners.forEach((listener) => {
      listener({ key });
    });
    return Promise.resolve();
  }
}

export interface TestContext {
  subscriptions: { dispose(): void }[];
  secrets: MemorySecrets;
  globalStorageUri: vscode.Uri;
  storageUri: vscode.Uri | undefined;
  extensionPath: string;
}

/** A fake `ExtensionContext` with storage directories under `root`. */
export function makeContext(root: string, options: { storage?: boolean } = {}): TestContext {
  return {
    subscriptions: [],
    secrets: new MemorySecrets(),
    globalStorageUri: vscode.Uri.file(`${root}/globalStorage`),
    storageUri: options.storage === false ? undefined : vscode.Uri.file(`${root}/workspaceStorage`),
    extensionPath: `${root}/extension`,
  };
}
