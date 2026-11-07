import type { NightCharge } from '../reservation';
import type { RoomType } from '../room';
import { dayToIso, isWeekendNight, toDayNumber, type StayDates } from '../stay-dates';

/** Strategy: how a stay is priced night by night. Totals are integer minor units. */
export interface PricingStrategy {
  priceNights(type: RoomType, dates: StayDates): NightCharge[];
}

/** Every night costs the room type's rack rate. */
export class StandardPricing implements PricingStrategy {
  priceNights(type: RoomType, dates: StayDates): NightCharge[] {
    return dates.nightDays().map((day) => ({ date: dayToIso(day), amount: type.nightlyRate }));
  }
}

export interface Season {
  /** First night of the season, inclusive. */
  from: string;
  /** First night after the season, exclusive (same half-open rule as stays). */
  until: string;
  surchargeBps: number;
}

/**
 * Weekend and seasonal surcharges in basis points. Surcharges add (20% + 50% = 70%)
 * rather than compound, and each night is rounded half-up to a whole minor unit.
 */
export class SeasonalPricing implements PricingStrategy {
  private readonly seasons: { start: number; end: number; bps: number }[];

  constructor(
    private readonly weekendSurchargeBps: number,
    seasons: Season[] = [],
  ) {
    this.seasons = seasons.map((s) => ({ start: toDayNumber(s.from), end: toDayNumber(s.until), bps: s.surchargeBps }));
  }

  priceNights(type: RoomType, dates: StayDates): NightCharge[] {
    return dates.nightDays().map((day) => {
      let bps = 10_000;
      if (isWeekendNight(day)) bps += this.weekendSurchargeBps;
      for (const season of this.seasons) if (day >= season.start && day < season.end) bps += season.bps;
      return { date: dayToIso(day), amount: Math.round((type.nightlyRate * bps) / 10_000) };
    });
  }
}
