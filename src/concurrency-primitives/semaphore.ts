import { PermitOverflowError } from './errors';

/**
 * Counting semaphore with FIFO hand-off. A release with someone waiting
 * passes the permit straight to the oldest waiter instead of returning it to
 * the pool, so a late caller can never barge past the queue (fairness).
 *
 * Java: java.util.concurrent.Semaphore(n, true). Go: a buffered channel of size n.
 */
export class Semaphore {
  private permits: number;
  private readonly waiters: (() => void)[] = [];

  constructor(
    initialPermits: number,
    readonly maxPermits = initialPermits,
  ) {
    if (!Number.isInteger(initialPermits) || initialPermits < 0) throw new RangeError('initialPermits must be >= 0');
    if (!Number.isInteger(maxPermits) || maxPermits < Math.max(1, initialPermits)) {
      throw new RangeError('maxPermits must be >= max(1, initialPermits)');
    }
    this.permits = initialPermits;
  }

  get available(): number {
    return this.permits;
  }

  get queueLength(): number {
    return this.waiters.length;
  }

  /** Never jumps the queue: fails while anyone is already waiting. */
  tryAcquire(): boolean {
    if (this.permits > 0 && this.waiters.length === 0) {
      this.permits -= 1;
      return true;
    }
    return false;
  }

  acquire(): Promise<void> {
    if (this.tryAcquire()) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // the permit moves to the waiter; the pool count is unchanged
      return;
    }
    if (this.permits >= this.maxPermits) throw new PermitOverflowError(this.maxPermits);
    this.permits += 1;
  }

  /** The safe API: the permit is returned even when `fn` throws. */
  async withPermit<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
