import type { Money } from '../../shared/money';
import type { Booking } from '../booking';

/** Strategy: what the airline keeps when a booking is cancelled. The refund is total minus fee. */
export interface CancellationFeeStrategy {
  feeFor(booking: Booking, cancelledAt: Date): Money;
}

/** A fixed fee per passenger, capped at the fare paid. */
export class FlatCancellationFee implements CancellationFeeStrategy {
  constructor(private readonly perPassenger: Money) {}

  feeFor(booking: Booking): Money {
    return Math.min(booking.total, this.perPassenger * booking.tickets.length);
  }
}

export interface FeeTier {
  minHoursBefore: number;
  percent: number;
}

/**
 * Percentage of the total by notice given: the first tier whose threshold is met
 * applies, and anything later than every tier forfeits the full fare. Fee floored.
 */
export class TimeBasedCancellationFee implements CancellationFeeStrategy {
  private readonly tiers: FeeTier[];

  constructor(tiers: FeeTier[] = [{ minHoursBefore: 72, percent: 10 }, { minHoursBefore: 24, percent: 50 }]) {
    this.tiers = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  }

  feeFor(booking: Booking, cancelledAt: Date): Money {
    const hoursBefore = (booking.instance.departureAt.getTime() - cancelledAt.getTime()) / 3_600_000;
    const tier = this.tiers.find((t) => hoursBefore >= t.minHoursBefore);
    return tier ? Math.floor((booking.total * tier.percent) / 100) : booking.total;
  }
}
