import type { Clock } from '../shared/clock';
import { InvalidTtlError } from './errors';

/**
 * TTL arithmetic shared by both caches so they agree on what "expired" means:
 * an entry put at t with ttl d is live until t + d - 1 ms and expired from
 * t + d. It is evaluated lazily against the injected Clock; there are no timers.
 */
export class ExpiryPolicy {
  constructor(
    private readonly clock: Clock,
    private readonly defaultTtlMs?: number,
  ) {
    if (defaultTtlMs !== undefined) assertTtl(defaultTtlMs);
  }

  /**
   * Absolute expiry in epoch milliseconds, or undefined for "never". Callers
   * compute it before mutating anything, so a bad TTL cannot evict an entry.
   */
  expiresAt(ttlMs: number | undefined = this.defaultTtlMs): number | undefined {
    if (ttlMs === undefined) return undefined;
    assertTtl(ttlMs);
    return this.clock.now().getTime() + ttlMs;
  }

  isExpired(expiresAt: number | undefined): boolean {
    return expiresAt !== undefined && this.clock.now().getTime() >= expiresAt;
  }
}

function assertTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new InvalidTtlError(ttlMs);
}
