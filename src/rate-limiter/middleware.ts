import { RateLimitExceededError } from './errors';
import type { RateLimitDecision, RateLimiter } from './rate-limiter';

export interface RateLimitOptions<Req, Res> {
  limiter: RateLimiter;
  /** Which bucket a request spends from: API key, user id, IP, or "user:endpoint". */
  keyOf: (request: Req) => string;
  /** Build the rejection (e.g. HTTP 429 with Retry-After). Without it the wrapper throws. */
  onLimited?: (request: Req, decision: RateLimitDecision) => Res;
}

/**
 * Decorator / middleware: wraps any handler so rate limiting stays out of
 * business code. The handler is not called at all when the request is denied.
 */
export function withRateLimit<Req, Res>(
  handler: (request: Req) => Res,
  options: RateLimitOptions<Req, Res>,
): (request: Req) => Res {
  return (request) => {
    const key = options.keyOf(request);
    const decision = options.limiter.allow(key);
    if (decision.allowed) return handler(request);
    if (options.onLimited) return options.onLimited(request, decision);
    throw new RateLimitExceededError(key, decision.retryAfterMs ?? 0);
  };
}
