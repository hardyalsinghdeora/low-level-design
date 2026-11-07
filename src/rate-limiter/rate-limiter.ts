/** The answer to "may this request through?", with what a client needs to back off politely. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Requests left right now after this one. */
  readonly remaining?: number;
  /** Set when denied: the earliest moment a retry can succeed, in ms from now. */
  readonly retryAfterMs?: number;
}

/**
 * Strategy interface: callers (middleware, a gateway) depend on this, never on
 * a concrete algorithm, so token bucket can be swapped for a sliding window
 * per endpoint or per tier.
 */
export interface RateLimiter {
  allow(key: string): RateLimitDecision;
}

/** Limit and window shared by the three window-based algorithms. */
export interface WindowConfig {
  limit: number;
  windowMs: number;
}
