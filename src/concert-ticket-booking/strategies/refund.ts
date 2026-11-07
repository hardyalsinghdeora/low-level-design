import type { Money } from '../../shared/money';
import type { Order } from '../order';

/** Strategy: what a fan gets back when they cancel. Organiser cancellations always refund in full. */
export interface RefundPolicy {
  refundFor(order: Order, cancelledAt: Date): Money;
}

export interface RefundTier {
  minDaysBefore: number;
  percent: number;
}

/** Percentage by notice given; floored to a whole minor unit, the remainder is kept by the organiser. */
export class TieredRefundPolicy implements RefundPolicy {
  private readonly tiers: RefundTier[];

  constructor(tiers: RefundTier[] = [{ minDaysBefore: 30, percent: 100 }, { minDaysBefore: 7, percent: 50 }]) {
    this.tiers = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  }

  refundFor(order: Order, cancelledAt: Date): Money {
    const daysBefore = (order.event.startsAt.getTime() - cancelledAt.getTime()) / 86_400_000;
    const tier = this.tiers.find((t) => daysBefore >= t.minDaysBefore);
    return tier ? Math.floor((order.total * tier.percent) / 100) : 0;
  }
}

/** Always refunds, minus a fixed handling fee per ticket. */
export class FlatFeeRefundPolicy implements RefundPolicy {
  constructor(private readonly feePerTicket: Money) {}

  refundFor(order: Order): Money {
    return Math.max(0, order.total - this.feePerTicket * order.ticketCount);
  }
}
