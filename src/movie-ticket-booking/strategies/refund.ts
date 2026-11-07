import type { Money } from '../../shared/money';
import type { Booking } from '../booking';

/** Strategy: how much of a confirmed booking is returned on cancellation. */
export interface RefundPolicy {
  refundFor(booking: Booking, cancelledAt: Date): Money;
}

export interface RefundTier {
  minHoursBefore: number;
  percent: number;
}

/**
 * Refund percentage by how early the user cancels. The refund is floored to a
 * whole minor unit; the remainder stays with the cinema, stated explicitly.
 */
export class TimeBasedRefundPolicy implements RefundPolicy {
  private readonly tiers: RefundTier[];

  constructor(tiers: RefundTier[] = [{ minHoursBefore: 24, percent: 100 }, { minHoursBefore: 2, percent: 50 }]) {
    this.tiers = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  }

  refundFor(booking: Booking, cancelledAt: Date): Money {
    const hoursBefore = (booking.show.startsAt.getTime() - cancelledAt.getTime()) / 3_600_000;
    const tier = this.tiers.find((t) => hoursBefore >= t.minHoursBefore);
    return tier ? Math.floor((booking.amount * tier.percent) / 100) : 0;
  }
}

export class NoRefundPolicy implements RefundPolicy {
  refundFor(): Money {
    return 0;
  }
}
