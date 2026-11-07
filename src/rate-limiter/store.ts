export interface Versioned<S> {
  readonly value: S;
  readonly version: number;
}

/**
 * Per-key limiter state. Writes are compare-and-set on a version so two
 * gateway nodes updating the same key cannot both spend the last token; the
 * in-memory implementation and a Redis or SQL one honour the same contract.
 */
export interface RateLimitStore<S> {
  read(key: string): Versioned<S> | undefined;
  /** Stores `value` only if the current version equals `expectedVersion` (0 = absent). */
  compareAndSet(key: string, expectedVersion: number, value: S): boolean;
}

export class InMemoryStore<S> implements RateLimitStore<S> {
  private readonly entries = new Map<string, Versioned<S>>();

  read(key: string): Versioned<S> | undefined {
    return this.entries.get(key);
  }

  compareAndSet(key: string, expectedVersion: number, value: S): boolean {
    const current = this.entries.get(key)?.version ?? 0;
    if (current !== expectedVersion) return false;
    this.entries.set(key, { value, version: current + 1 });
    return true;
  }

  get size(): number {
    return this.entries.size;
  }
}
