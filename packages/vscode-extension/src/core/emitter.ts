/** What a listener registration returns; structurally compatible with `vscode.Disposable`. */
export interface Disposable {
  dispose(): void;
}

/** Subscribes a listener; structurally compatible with `vscode.Event<T>`. */
export type Event<T> = (listener: (event: T) => void) => Disposable;

/**
 * A minimal event emitter with no `vscode` dependency. A listener that throws never prevents the other listeners
 * from running (and never breaks the code that fired the event); the error goes to `onListenerError`.
 */
export class Emitter<T> {
  private listeners: ((event: T) => void)[] = [];

  constructor(private readonly onListenerError: (error: unknown) => void = () => undefined) {}

  readonly event: Event<T> = (listener) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}
