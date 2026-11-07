import { assertMoney, type Money } from '../../shared/money';
import type { Location } from '../geo';

export interface FareInput {
  readonly distanceKm: number;
  readonly durationMinutes: number;
  /** Whole percent; 100 = no surge. */
  readonly surgePercent: number;
}

export interface FareBreakdown {
  readonly base: Money;
  readonly distanceCharge: Money;
  readonly timeCharge: Money;
  readonly surgePercent: number;
  readonly total: Money;
}

/** Strategy: how a completed trip is priced. */
export interface FareStrategy {
  calculate(input: FareInput): FareBreakdown;
}

/**
 * base + per km + per minute, at least the minimum, then times the surge.
 * Distance is rounded to the nearest minor unit; surge rounds up so it never undercharges.
 */
export class StandardFare implements FareStrategy {
  constructor(
    private readonly rates: { base: Money; perKm: Money; perMinute: Money; minimum: Money },
  ) {
    for (const [label, value] of Object.entries(rates)) assertMoney(value, label);
  }

  calculate({ distanceKm, durationMinutes, surgePercent }: FareInput): FareBreakdown {
    const distanceCharge = Math.round(distanceKm * this.rates.perKm);
    const timeCharge = durationMinutes * this.rates.perMinute;
    const beforeSurge = Math.max(this.rates.minimum, this.rates.base + distanceCharge + timeCharge);
    const total = Math.ceil((beforeSurge * surgePercent) / 100);
    return { base: this.rates.base, distanceCharge, timeCharge, surgePercent, total };
  }
}

export interface MarketSnapshot {
  readonly pickup: Location;
  readonly at: Date;
  /** Riders waiting or requesting right now, including this one. */
  readonly openRequests: number;
  readonly onlineDrivers: number;
}

/** Strategy: the surge multiplier, as whole percent, at request time. */
export interface SurgeProvider {
  surgePercent(market: MarketSnapshot): number;
}

export class FixedSurge implements SurgeProvider {
  constructor(private readonly percent = 100) {}

  surgePercent(): number {
    return this.percent;
  }
}

/** Surge follows the demand / supply ratio in steps of 10%, capped. */
export class DemandBasedSurge implements SurgeProvider {
  constructor(private readonly capPercent = 250) {}

  surgePercent({ openRequests, onlineDrivers }: MarketSnapshot): number {
    if (onlineDrivers >= openRequests) return 100;
    if (onlineDrivers === 0) return this.capPercent;
    const ratio = Math.ceil(((openRequests / onlineDrivers) * 100) / 10) * 10;
    return Math.min(this.capPercent, ratio);
  }
}
