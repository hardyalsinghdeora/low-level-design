import { NotLockedError } from './errors';
import { Semaphore } from './semaphore';

/**
 * Async mutual exclusion: at most one holder across `await`s, waiters served
 * in arrival order. Built on a one-permit fair semaphore. JavaScript has no
 * thread identity, so "release by a non-owner" cannot be detected; prefer
 * `withLock`, which pairs acquire and release for you.
 *
 * Java: ReentrantLock(true) without re-entrancy. Go: sync.Mutex (which is not FIFO).
 */
export class Mutex {
  private readonly semaphore = new Semaphore(1);

  get isLocked(): boolean {
    return this.semaphore.available === 0;
  }

  get waiting(): number {
    return this.semaphore.queueLength;
  }

  acquire(): Promise<void> {
    return this.semaphore.acquire();
  }

  tryAcquire(): boolean {
    return this.semaphore.tryAcquire();
  }

  release(): void {
    if (!this.isLocked) throw new NotLockedError('Mutex');
    this.semaphore.release();
  }

  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
