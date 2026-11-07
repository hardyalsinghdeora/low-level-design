import { Clock, SystemClock } from '../../shared/clock';
import { InvalidKeyError, StoreContentionError } from '../errors';
import type { RateLimitDecision, RateLimiter } from '../rate-limiter';
import { InMemoryStore, type RateLimitStore } from '../store';

export interface Evaluation<S> {
  readonly state: S;
  readonly decision: RateLimitDecision;
}

export interface LimiterOptions<S> {
  clock?: Clock;
  store?: RateLimitStore<S>;
  /** Compare-and-set retries before giving up on a hot key. */
  maxCasAttempts?: number;
}

/**
 * Template method shared by every algorithm: read state, compute the next
 * state and decision as a pure function of (state, now), then compare-and-set.
 * Algorithms never touch the store or the clock, so each one is a small pure
 * function that is easy to test at window edges.
 */
export abstract class StoreBackedLimiter<S> implements RateLimiter {
  private readonly clock: Clock;
  private readonly store: RateLimitStore<S>;
  private readonly maxCasAttempts: number;

  constructor(options: LimiterOptions<S> = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.store = options.store ?? new InMemoryStore<S>();
    this.maxCasAttempts = options.maxCasAttempts ?? 3;
  }

  allow(key: string): RateLimitDecision {
    if (key.length === 0) throw new InvalidKeyError();
    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      const current = this.store.read(key);
      const { state, decision } = this.evaluate(current?.value, this.clock.now().getTime());
      if (this.store.compareAndSet(key, current?.version ?? 0, state)) return decision;
    }
    throw new StoreContentionError(key, this.maxCasAttempts);
  }

  protected abstract evaluate(state: S | undefined, nowMs: number): Evaluation<S>;
}
