import { assertPositiveInteger } from '../errors';
import type { WindowConfig } from '../rate-limiter';
import { type Evaluation, type LimiterOptions, StoreBackedLimiter } from './store-backed-limiter';

export interface FixedWindowState {
  readonly windowStart: number;
  readonly count: number;
}

/**
 * One counter per aligned window. O(1) state and trivially atomic in Redis
 * (INCR + EXPIRE), at the cost of allowing up to 2x the limit across a window
 * boundary.
 */
export class FixedWindowLimiter extends StoreBackedLimiter<FixedWindowState> {
  constructor(
    private readonly config: WindowConfig,
    options: LimiterOptions<FixedWindowState> = {},
  ) {
    super(options);
    assertPositiveInteger('limit', config.limit);
    assertPositiveInteger('windowMs', config.windowMs);
  }

  protected evaluate(state: FixedWindowState | undefined, nowMs: number): Evaluation<FixedWindowState> {
    const { limit, windowMs } = this.config;
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const count = state && state.windowStart === windowStart ? state.count : 0;
    if (count < limit) {
      return { state: { windowStart, count: count + 1 }, decision: { allowed: true, remaining: limit - count - 1 } };
    }
    return {
      state: { windowStart, count },
      decision: { allowed: false, remaining: 0, retryAfterMs: windowStart + windowMs - nowMs },
    };
  }
}
