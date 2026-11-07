import { assertPositiveInteger } from '../errors';
import type { WindowConfig } from '../rate-limiter';
import { type Evaluation, type LimiterOptions, StoreBackedLimiter } from './store-backed-limiter';

export interface SlidingWindowCounterState {
  readonly windowStart: number;
  readonly current: number;
  readonly previous: number;
}

/**
 * Approximates the sliding log with two counters: the previous window counts
 * in proportion to how much of it still overlaps the sliding window. The test
 * `previous * (W - elapsed) + (current + 1) * W <= limit * W` is the weighted
 * estimate multiplied through by W, so it stays in integers.
 */
export class SlidingWindowCounterLimiter extends StoreBackedLimiter<SlidingWindowCounterState> {
  constructor(
    private readonly config: WindowConfig,
    options: LimiterOptions<SlidingWindowCounterState> = {},
  ) {
    super(options);
    assertPositiveInteger('limit', config.limit);
    assertPositiveInteger('windowMs', config.windowMs);
  }

  protected evaluate(
    state: SlidingWindowCounterState | undefined,
    nowMs: number,
  ): Evaluation<SlidingWindowCounterState> {
    const { limit, windowMs: w } = this.config;
    const windowStart = Math.floor(nowMs / w) * w;
    let current = 0;
    let previous = 0;
    if (state?.windowStart === windowStart) {
      current = state.current;
      previous = state.previous;
    } else if (state?.windowStart === windowStart - w) {
      previous = state.current;
    }
    const elapsed = nowMs - windowStart;

    if (previous * (w - elapsed) + (current + 1) * w <= limit * w) {
      const used = previous * (w - elapsed) + (current + 1) * w;
      return {
        state: { windowStart, current: current + 1, previous },
        decision: { allowed: true, remaining: Math.floor((limit * w - used) / w) },
      };
    }
    return {
      state: { windowStart, current, previous },
      decision: { allowed: false, remaining: 0, retryAfterMs: this.retryAfter(previous, current, elapsed) },
    };
  }

  /** Earliest elapsed time at which one more request fits, searching this window, then the next, then the one after. */
  private retryAfter(previous: number, current: number, elapsed: number): number {
    const w = this.config.windowMs;
    const inThisWindow = this.firstFit(previous, current);
    if (inThisWindow !== undefined) return inThisWindow - elapsed;
    const inNextWindow = this.firstFit(current, 0);
    if (inNextWindow !== undefined) return w - elapsed + inNextWindow;
    return 2 * w - elapsed;
  }

  /** Smallest elapsed e in [0, W) with previous * (W - e) <= (limit - current - 1) * W, if any. */
  private firstFit(previous: number, current: number): number | undefined {
    const { limit, windowMs: w } = this.config;
    const room = (limit - current - 1) * w;
    if (room < 0) return undefined;
    const e = previous === 0 ? 0 : Math.max(0, w - Math.floor(room / previous));
    return e < w ? e : undefined;
  }
}
