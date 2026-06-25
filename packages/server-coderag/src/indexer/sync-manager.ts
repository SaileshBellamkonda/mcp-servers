import type { SyncStatus } from '../core/types.js';

export class SyncInProgressError extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`A sync operation is already in progress: ${operation}`);
    this.name = 'SyncInProgressError';
    this.operation = operation;
  }
}

export class SyncManager {
  private _inProgress = false;
  private _operation: string | null = null;
  private _startedAt: Date | null = null;

  get status(): SyncStatus {
    return {
      inProgress: this._inProgress,
      operation: this._operation,
      startedAt: this._startedAt,
    };
  }

  get inProgress(): boolean {
    return this._inProgress;
  }

  async run(operation: string, fn: () => Promise<void>): Promise<void> {
    if (this._inProgress) {
      throw new SyncInProgressError(this._operation ?? operation);
    }
    this._inProgress = true;
    this._operation = operation;
    this._startedAt = new Date();
    try {
      await fn();
    } finally {
      this._inProgress = false;
      this._operation = null;
      this._startedAt = null;
    }
  }
}

export function syncLockedResponse(status: SyncStatus): { content: [{ type: 'text'; text: string }] } {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        locked: true,
        operation: status.operation,
        startedAt: status.startedAt?.toISOString() ?? null,
        message: `A sync operation ("${status.operation ?? 'unknown'}") is currently running. Try again when it completes.`,
      }),
    }],
  };
}
