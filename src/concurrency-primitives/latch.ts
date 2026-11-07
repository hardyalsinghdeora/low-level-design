/**
 * One-shot gate: `wait()` resolves once `countDown()` has been called `count`
 * times. Extra count-downs are ignored, as in Java.
 *
 * Java: CountDownLatch. Go: sync.WaitGroup (Add/Done/Wait).
 */
export class CountDownLatch {
  private remaining: number;
  private readonly waiters: (() => void)[] = [];

  constructor(count: number) {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
    this.remaining = count;
  }

  get count(): number {
    return this.remaining;
  }

  countDown(): void {
    if (this.remaining === 0) return;
    this.remaining -= 1;
    if (this.remaining === 0) for (const release of this.waiters.splice(0)) release();
  }

  wait(): Promise<void> {
    if (this.remaining === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

/**
 * Reusable rendezvous for `parties` workers. The last arrival trips the
 * barrier, runs the optional action and releases everyone with the
 * generation number; the barrier then resets for the next round.
 *
 * Java: CyclicBarrier(parties, action). Go: no built-in; a WaitGroup per round or a channel.
 */
export class Barrier {
  private generation = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    readonly parties: number,
    private readonly onTrip?: (generation: number) => void,
  ) {
    if (!Number.isInteger(parties) || parties < 1) throw new RangeError('parties must be a positive integer');
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  arrive(): Promise<number> {
    const generation = this.generation;
    return new Promise<number>((resolve) => {
      this.waiting.push(() => resolve(generation));
      if (this.waiting.length < this.parties) return;
      const batch = this.waiting.splice(0);
      this.generation += 1;
      this.onTrip?.(generation);
      for (const release of batch) release();
    });
  }
}
