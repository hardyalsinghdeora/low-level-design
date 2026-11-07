/**
 * Producer-consumer buffer with backpressure. `put` waits while the buffer is
 * full and `take` waits while it is empty. Items are handed directly to a
 * waiting consumer, and a waiting producer's item moves in the moment a slot
 * frees, so global FIFO order is preserved and no wake-up is ever lost.
 *
 * Java: ArrayBlockingQueue(capacity, true). Go: make(chan T, capacity).
 */
export class BoundedBlockingQueue<T> {
  private readonly items: T[] = [];
  private readonly takers: ((item: T) => void)[] = [];
  private readonly putters: { item: T; resolve: () => void }[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
  }

  get size(): number {
    return this.items.length;
  }

  get waitingProducers(): number {
    return this.putters.length;
  }

  get waitingConsumers(): number {
    return this.takers.length;
  }

  /** Non-blocking put: false when full. */
  offer(item: T): boolean {
    const taker = this.takers.shift();
    if (taker) {
      taker(item);
      return true;
    }
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return true;
    }
    return false;
  }

  put(item: T): Promise<void> {
    if (this.offer(item)) return Promise.resolve();
    return new Promise<void>((resolve) => this.putters.push({ item, resolve }));
  }

  /** Non-blocking take: undefined when empty. */
  poll(): T | undefined {
    return this.items.length > 0 ? this.dequeue() : undefined;
  }

  take(): Promise<T> {
    if (this.items.length > 0) return Promise.resolve(this.dequeue());
    return new Promise<T>((resolve) => this.takers.push(resolve));
  }

  private dequeue(): T {
    const item = this.items[0];
    this.items.shift();
    const putter = this.putters.shift();
    if (putter) {
      this.items.push(putter.item);
      putter.resolve();
    }
    return item;
  }
}
