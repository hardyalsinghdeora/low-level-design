import { assertPositiveInteger } from '../errors';
import { type Evaluation, type LimiterOptions, StoreBackedLimiter } from './store-backed-limiter';

export interface TokenBucketConfig {
  /** Largest burst allowed. */
  capacity: number;
  /** Tokens added every `refillEveryMs`. */
  refillTokens: number;
  refillEveryMs: number;
}

export interface TokenBucketState {
  readonly tokens: number;
  readonly lastRefillMs: number;
}

/**
 * Allows bursts up to `capacity`, then a steady `refillTokens / refillEveryMs`.
 * Refill is in whole periods (integers only); the part of a period that has
 * not completed is kept, so no time is lost between calls.
 */
export class TokenBucketLimiter extends StoreBackedLimiter<TokenBucketState> {
  constructor(
    private readonly config: TokenBucketConfig,
    options: LimiterOptions<TokenBucketState> = {},
  ) {
    super(options);
    assertPositiveInteger('capacity', config.capacity);
    assertPositiveInteger('refillTokens', config.refillTokens);
    assertPositiveInteger('refillEveryMs', config.refillEveryMs);
  }

  protected evaluate(state: TokenBucketState | undefined, nowMs: number): Evaluation<TokenBucketState> {
    const { capacity, refillTokens, refillEveryMs } = this.config;
    let tokens = state?.tokens ?? capacity;
    let lastRefillMs = state?.lastRefillMs ?? nowMs;

    const periods = Math.floor((nowMs - lastRefillMs) / refillEveryMs);
    if (periods > 0) {
      tokens = Math.min(capacity, tokens + periods * refillTokens);
      lastRefillMs += periods * refillEveryMs;
    }
    if (tokens >= capacity) lastRefillMs = nowMs; // a full bucket does not bank idle time

    if (tokens > 0) {
      return { state: { tokens: tokens - 1, lastRefillMs }, decision: { allowed: true, remaining: tokens - 1 } };
    }
    return {
      state: { tokens, lastRefillMs },
      decision: { allowed: false, remaining: 0, retryAfterMs: lastRefillMs + refillEveryMs - nowMs },
    };
  }
}
