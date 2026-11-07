export enum SubscriptionTier {
  FREE = 'FREE',
  PREMIUM = 'PREMIUM',
}

/** Strategy: the commercial rules that differ between tiers. The player never checks the tier itself. */
export interface TierPolicy {
  readonly tier: SubscriptionTier;
  readonly adDurationSec: number;
  readonly maxSkipsPerHour: number;
  /** How many skips are left given the times of earlier skips. */
  skipsRemaining(skipTimes: readonly Date[], now: Date): number;
  adDue(songsSinceLastAd: number): boolean;
}

const HOUR_MS = 60 * 60 * 1_000;

export interface FreeTierOptions {
  maxSkipsPerHour?: number;
  songsBetweenAds?: number;
  adDurationSec?: number;
}

/** A rolling one-hour window, not a calendar hour, so skips cannot be bunched around :00. */
export class FreeTierPolicy implements TierPolicy {
  readonly tier = SubscriptionTier.FREE;
  readonly maxSkipsPerHour: number;
  readonly songsBetweenAds: number;
  readonly adDurationSec: number;

  constructor(options: FreeTierOptions = {}) {
    this.maxSkipsPerHour = options.maxSkipsPerHour ?? 6;
    this.songsBetweenAds = options.songsBetweenAds ?? 3;
    this.adDurationSec = options.adDurationSec ?? 30;
  }

  skipsRemaining(skipTimes: readonly Date[], now: Date): number {
    const inWindow = skipTimes.filter((t) => now.getTime() - t.getTime() < HOUR_MS).length;
    return Math.max(0, this.maxSkipsPerHour - inWindow);
  }

  adDue(songsSinceLastAd: number): boolean {
    return songsSinceLastAd >= this.songsBetweenAds;
  }
}

export class PremiumTierPolicy implements TierPolicy {
  readonly tier = SubscriptionTier.PREMIUM;
  readonly adDurationSec = 0;
  readonly maxSkipsPerHour = Number.POSITIVE_INFINITY;

  skipsRemaining(): number {
    return Number.POSITIVE_INFINITY;
  }

  adDue(): boolean {
    return false;
  }
}

export function policyFor(tier: SubscriptionTier, free: FreeTierOptions = {}): TierPolicy {
  return tier === SubscriptionTier.FREE ? new FreeTierPolicy(free) : new PremiumTierPolicy();
}
