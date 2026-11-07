import type { RateLimitDecision, RateLimiter } from './rate-limiter';

export enum Tier {
  FREE = 'FREE',
  PRO = 'PRO',
}

/** Strategy: where a key's plan comes from (a static map here; a billing lookup in production). */
export interface TierResolver {
  tierFor(key: string): Tier;
}

export class StaticTierResolver implements TierResolver {
  private readonly tiers: ReadonlyMap<string, Tier>;

  constructor(
    tiers: Record<string, Tier>,
    private readonly fallback: Tier = Tier.FREE,
  ) {
    this.tiers = new Map(Object.entries(tiers));
  }

  tierFor(key: string): Tier {
    return this.tiers.get(key) ?? this.fallback;
  }
}

/**
 * Composite limiter: picks the limiter configured for the key's tier. Each
 * tier owns its own state, so an upgrade starts the key with a fresh budget.
 */
export class TieredRateLimiter implements RateLimiter {
  constructor(
    private readonly resolver: TierResolver,
    private readonly limiters: Readonly<Record<Tier, RateLimiter>>,
  ) {}

  allow(key: string): RateLimitDecision {
    return this.limiters[this.resolver.tierFor(key)].allow(key);
  }
}
