import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import {
  FixedWindowLimiter,
  type FixedWindowState,
  InMemoryStore,
  InvalidKeyError,
  InvalidRateLimitConfigError,
  type LimiterOptions,
  RateLimitExceededError,
  type RateLimiter,
  type RateLimitStore,
  SlidingWindowCounterLimiter,
  SlidingWindowLogLimiter,
  StaticTierResolver,
  StoreContentionError,
  Tier,
  TieredRateLimiter,
  TokenBucketLimiter,
  type Versioned,
  withRateLimit,
} from './index';

const START = '2026-01-01T09:00:00.000Z';
const advanceMs = (clock: FakeClock, ms: number): void => clock.set(new Date(clock.now().getTime() + ms));

type Factory = (limit: number, clock: FakeClock) => RateLimiter;
const algorithms: Array<[string, Factory]> = [
  ['TokenBucket', (limit, clock) => new TokenBucketLimiter({ capacity: limit, refillTokens: 1, refillEveryMs: 1_000 }, { clock })],
  ['FixedWindow', (limit, clock) => new FixedWindowLimiter({ limit, windowMs: 1_000 }, { clock })],
  ['SlidingWindowLog', (limit, clock) => new SlidingWindowLogLimiter({ limit, windowMs: 1_000 }, { clock })],
  ['SlidingWindowCounter', (limit, clock) => new SlidingWindowCounterLimiter({ limit, windowMs: 1_000 }, { clock })],
];

describe.each(algorithms)('%s (shared RateLimiter contract)', (_name, create) => {
  it('allows exactly the limit at one instant, counts down remaining, then denies per key', () => {
    const limiter = create(3, new FakeClock(START));
    expect([1, 2, 3].map(() => limiter.allow('alice').remaining)).toEqual([2, 1, 0]);
    const denied = limiter.allow('alice');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.allow('bob').allowed).toBe(true); // keys are isolated
    expect(() => limiter.allow('')).toThrow(InvalidKeyError);
  });
});

describe('TokenBucketLimiter', () => {
  it('reports the time to the next refill and keeps partial periods', () => {
    const clock = new FakeClock(START);
    const bucket = new TokenBucketLimiter({ capacity: 3, refillTokens: 1, refillEveryMs: 1_000 }, { clock });
    for (let i = 0; i < 3; i += 1) bucket.allow('k');
    expect(bucket.allow('k')).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1_000 });
    advanceMs(clock, 400);
    expect(bucket.allow('k').retryAfterMs).toBe(600);
    advanceMs(clock, 1_100); // t = 1500: one token, 500 ms banked toward the next
    expect(bucket.allow('k')).toEqual({ allowed: true, remaining: 0 });
    advanceMs(clock, 500); // t = 2000: the banked half completes a period
    expect(bucket.allow('k').allowed).toBe(true);
  });

  it('never refills beyond capacity after a long idle period', () => {
    const clock = new FakeClock(START);
    const bucket = new TokenBucketLimiter({ capacity: 2, refillTokens: 2, refillEveryMs: 1_000 }, { clock });
    bucket.allow('k');
    advanceMs(clock, 3_600_000);
    expect([bucket.allow('k'), bucket.allow('k'), bucket.allow('k')].map((d) => d.allowed)).toEqual([true, true, false]);
  });
});

describe('FixedWindowLimiter', () => {
  it('resets at the window edge and so admits a 2x burst across it', () => {
    const clock = new FakeClock('2026-01-01T09:00:00.900Z');
    const limiter = new FixedWindowLimiter({ limit: 3, windowMs: 1_000 }, { clock });
    for (let i = 0; i < 3; i += 1) expect(limiter.allow('k').allowed).toBe(true);
    expect(limiter.allow('k').retryAfterMs).toBe(100);
    advanceMs(clock, 100); // new window
    for (let i = 0; i < 3; i += 1) expect(limiter.allow('k').allowed).toBe(true);
    expect(limiter.allow('k').allowed).toBe(false); // 6 accepted within 100 ms
  });
});

describe('SlidingWindowLogLimiter', () => {
  it('has no boundary burst and frees a slot exactly one window after the oldest request', () => {
    const clock = new FakeClock(START);
    const limiter = new SlidingWindowLogLimiter({ limit: 2, windowMs: 1_000 }, { clock });
    limiter.allow('k'); // t=0
    advanceMs(clock, 300);
    limiter.allow('k'); // t=300
    advanceMs(clock, 600);
    expect(limiter.allow('k').retryAfterMs).toBe(100); // t=900: oldest leaves at 1000
    advanceMs(clock, 99);
    expect(limiter.allow('k').allowed).toBe(false);
    advanceMs(clock, 1);
    expect(limiter.allow('k')).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.allow('k').retryAfterMs).toBe(300); // denied calls were not logged
  });
});

describe('SlidingWindowCounterLimiter', () => {
  it('weights the previous window by its overlap and predicts retryAfter exactly', () => {
    const clock = new FakeClock(START);
    const limiter = new SlidingWindowCounterLimiter({ limit: 10, windowMs: 1_000 }, { clock });
    for (let i = 0; i < 10; i += 1) limiter.allow('k');
    advanceMs(clock, 1_300); // 70% of the previous 10 still counts: 7
    expect([1, 2, 3].map(() => limiter.allow('k').allowed)).toEqual([true, true, true]);
    const denied = limiter.allow('k');
    expect(denied).toEqual({ allowed: false, remaining: 0, retryAfterMs: 100 });
    advanceMs(clock, 99);
    expect(limiter.allow('k').allowed).toBe(false);
    advanceMs(clock, 1);
    expect(limiter.allow('k').allowed).toBe(true);
  });

  it('forgets everything after two idle windows and waits two windows when limit is 1', () => {
    const clock = new FakeClock(START);
    const limiter = new SlidingWindowCounterLimiter({ limit: 1, windowMs: 1_000 }, { clock });
    limiter.allow('k');
    expect(limiter.allow('k').retryAfterMs).toBe(2_000); // the previous window weighs in until it fully slides out
    advanceMs(clock, 2_000);
    expect(limiter.allow('k').allowed).toBe(true);
  });
});

describe('Tiers, middleware and configuration', () => {
  it('chooses the limiter by tier, falling back to FREE for unknown keys', () => {
    const clock = new FakeClock(START);
    const limiter = new TieredRateLimiter(new StaticTierResolver({ acme: Tier.PRO }), {
      [Tier.FREE]: new FixedWindowLimiter({ limit: 1, windowMs: 60_000 }, { clock }),
      [Tier.PRO]: new FixedWindowLimiter({ limit: 5, windowMs: 60_000 }, { clock }),
    });
    expect([limiter.allow('anon').allowed, limiter.allow('anon').allowed]).toEqual([true, false]);
    expect(limiter.allow('acme').remaining).toBe(4);
  });

  it('wraps a handler: passes through, maps to a 429, or throws with retryAfter', () => {
    const clock = new FakeClock(START);
    const calls: string[] = [];
    const options = { limiter: new FixedWindowLimiter({ limit: 1, windowMs: 1_000 }, { clock }), keyOf: (user: string) => user };
    const handler = withRateLimit((user: string) => {
      calls.push(user);
      return 200;
    }, { ...options, onLimited: () => 429 });
    expect([handler('u1'), handler('u1')]).toEqual([200, 429]);
    expect(calls).toEqual(['u1']); // the handler never runs for a denied request

    const strict = withRateLimit((user: string) => user, {
      limiter: new FixedWindowLimiter({ limit: 1, windowMs: 1_000 }, { clock }),
      keyOf: (user: string) => user,
    });
    strict('u2');
    expect(() => strict('u2')).toThrow(RateLimitExceededError);
    try {
      strict('u2');
    } catch (error) {
      expect(error instanceof RateLimitExceededError && error.retryAfterMs).toBe(1_000);
    }
  });

  it('rejects non-positive or fractional configuration', () => {
    expect(() => new TokenBucketLimiter({ capacity: 0, refillTokens: 1, refillEveryMs: 1 })).toThrow(InvalidRateLimitConfigError);
    expect(() => new FixedWindowLimiter({ limit: 1, windowMs: 0 })).toThrow(InvalidRateLimitConfigError);
    expect(() => new SlidingWindowLogLimiter({ limit: 1.5, windowMs: 10 })).toThrow(InvalidRateLimitConfigError);
    expect(() => new SlidingWindowCounterLimiter({ limit: -1, windowMs: 10 })).toThrow(InvalidRateLimitConfigError);
  });

  it('retries the compare-and-set when another writer got there first, and gives up on a hot key', () => {
    class RacingStore<S> implements RateLimitStore<S> {
      readonly inner = new InMemoryStore<S>();
      constructor(private conflictsLeft: number) {}
      read(key: string): Versioned<S> | undefined {
        return this.inner.read(key);
      }
      compareAndSet(key: string, expectedVersion: number, value: S): boolean {
        if (this.conflictsLeft > 0) {
          this.conflictsLeft -= 1;
          return false;
        }
        return this.inner.compareAndSet(key, expectedVersion, value);
      }
    }
    const clock = new FakeClock(START);
    type S = FixedWindowState;
    const store = new RacingStore<S>(2);
    const options: LimiterOptions<S> = { clock, store, maxCasAttempts: 3 };
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 1_000 }, options);
    expect(limiter.allow('k').remaining).toBe(4);
    expect(store.inner.read('k')?.value.count).toBe(1); // counted once despite two retries

    const hot = new FixedWindowLimiter({ limit: 5, windowMs: 1_000 }, { clock, store: new RacingStore<S>(10) });
    expect(() => hot.allow('k')).toThrow(StoreContentionError);
  });
});
