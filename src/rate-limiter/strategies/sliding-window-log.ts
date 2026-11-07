import { assertPositiveInteger } from '../errors';
import type { WindowConfig } from '../rate-limiter';
import { type Evaluation, type LimiterOptions, StoreBackedLimiter } from './store-backed-limiter';

export interface SlidingWindowLogState {
  /** Accepted request times, oldest first, all within the last window. */
  readonly timestamps: readonly number[];
}

/**
 * Exact: at most `limit` accepted requests in any window (now - windowMs, now].
 * Costs O(limit) memory per key, which is why the counter variant exists.
 * Denied requests are not logged, so a client hammering the API does not
 * push its own retry time further out.
 */
export class SlidingWindowLogLimiter extends StoreBackedLimiter<SlidingWindowLogState> {
  constructor(
    private readonly config: WindowConfig,
    options: LimiterOptions<SlidingWindowLogState> = {},
  ) {
    super(options);
    assertPositiveInteger('limit', config.limit);
    assertPositiveInteger('windowMs', config.windowMs);
  }

  protected evaluate(state: SlidingWindowLogState | undefined, nowMs: number): Evaluation<SlidingWindowLogState> {
    const { limit, windowMs } = this.config;
    const live = (state?.timestamps ?? []).filter((t) => t > nowMs - windowMs);
    if (live.length < limit) {
      return {
        state: { timestamps: [...live, nowMs] },
        decision: { allowed: true, remaining: limit - live.length - 1 },
      };
    }
    return {
      state: { timestamps: live },
      decision: { allowed: false, remaining: 0, retryAfterMs: live[0]! + windowMs - nowMs },
    };
  }
}
