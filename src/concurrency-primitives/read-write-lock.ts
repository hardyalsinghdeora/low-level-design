import { NotLockedError } from './errors';

/**
 * Many readers or one writer, with writer preference: once a writer is
 * waiting, new readers queue behind it, so a steady stream of readers can
 * never starve a writer. When a writer finishes, the next waiting writer goes
 * first; only when none is waiting are all queued readers admitted together.
 *
 * Java: ReentrantReadWriteLock (its fair mode is arrival order). Go: sync.RWMutex,
 * which also blocks new readers once a writer is waiting.
 */
export class ReadWriteLock {
  private readers = 0;
  private writing = false;
  private readonly waitingReaders: (() => void)[] = [];
  private readonly waitingWriters: (() => void)[] = [];

  get activeReaders(): number {
    return this.readers;
  }

  get isWriteLocked(): boolean {
    return this.writing;
  }

  get pendingWriters(): number {
    return this.waitingWriters.length;
  }

  acquireRead(): Promise<void> {
    if (!this.writing && this.waitingWriters.length === 0) {
      this.readers += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waitingReaders.push(resolve));
  }

  acquireWrite(): Promise<void> {
    if (!this.writing && this.readers === 0 && this.waitingWriters.length === 0) {
      this.writing = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waitingWriters.push(resolve));
  }

  releaseRead(): void {
    if (this.readers === 0) throw new NotLockedError('ReadWriteLock read side');
    this.readers -= 1;
    if (this.readers === 0) this.grantNext();
  }

  releaseWrite(): void {
    if (!this.writing) throw new NotLockedError('ReadWriteLock write side');
    this.writing = false;
    this.grantNext();
  }

  async withReadLock<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireRead();
    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  async withWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireWrite();
    try {
      return await fn();
    } finally {
      this.releaseWrite();
    }
  }

  private grantNext(): void {
    const writer = this.waitingWriters.shift();
    if (writer) {
      this.writing = true;
      writer();
      return;
    }
    while (this.waitingReaders.length > 0) {
      this.readers += 1;
      this.waitingReaders.shift()?.();
    }
  }
}
