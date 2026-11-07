import { assertMoney, type Money } from '../../shared/money';
import { FoodOrderStatus, type FoodOrder } from '../food-order';

export interface DeliveryQuote {
  readonly distanceKm: number;
  readonly itemTotal: Money;
  readonly at: Date;
}

/** Strategy: what the customer pays for delivery. */
export interface DeliveryPricingStrategy {
  fee(quote: DeliveryQuote): Money;
}

/** Base fee plus a rate per started kilometre; free above a basket size if configured. */
export class DistancePricing implements DeliveryPricingStrategy {
  constructor(
    private readonly base: Money,
    private readonly perKm: Money,
    private readonly freeAbove: Money | null = null,
  ) {
    assertMoney(base, 'base');
    assertMoney(perKm, 'perKm');
  }

  fee({ distanceKm, itemTotal }: DeliveryQuote): Money {
    if (this.freeAbove !== null && itemTotal >= this.freeAbove) return 0;
    return this.base + Math.ceil(distanceKm) * this.perKm;
  }
}

/** Surge in whole percent (150 = 1.5x), from a provider that reads demand, weather or time of day. */
export type SurgeProvider = (at: Date) => number;

/** Decorator over any pricing strategy. Rounds up to a whole paisa so surge never undercharges. */
export class SurgePricing implements DeliveryPricingStrategy {
  constructor(
    private readonly inner: DeliveryPricingStrategy,
    private readonly surgePercent: SurgeProvider,
  ) {}

  fee(quote: DeliveryQuote): Money {
    const percent = Math.max(100, Math.round(this.surgePercent(quote.at)));
    return Math.ceil((this.inner.fee(quote) * percent) / 100);
  }
}

/** Strategy: what a cancellation costs the customer, by how far the order has got. */
export interface CancellationPolicy {
  fee(order: FoodOrder): Money;
}

/**
 * Free before the kitchen accepts, a share of the food once accepted, all of
 * the food once cooking has started. The delivery fee is always refunded.
 */
export class StateBasedCancellationPolicy implements CancellationPolicy {
  constructor(
    private readonly percentByStatus: Partial<Record<FoodOrderStatus, number>> = {
      [FoodOrderStatus.PLACED]: 0,
      [FoodOrderStatus.ACCEPTED]: 25,
      [FoodOrderStatus.PREPARING]: 100,
    },
  ) {}

  fee(order: FoodOrder): Money {
    const percent = this.percentByStatus[order.status] ?? 100;
    return Math.floor((order.itemTotal * percent) / 100);
  }
}
