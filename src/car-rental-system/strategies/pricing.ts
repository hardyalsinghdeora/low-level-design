import { assertMoney, formatMoney, type Money } from '../../shared/money';
import { Invoice, LineItemKind, type LineItem } from '../invoice';
import type { RentalExtra, RentalTerms } from '../reservation';

/** Strategy pattern: how a rental is priced changes with markets and promotions, not with the booking flow. */
export interface PricingStrategy {
  /** Itemised price if the car comes back at `returnedAt`. A quote is `price(terms, terms.period.end)`. */
  price(terms: RentalTerms, returnedAt: Date): Invoice;
}

export interface StandardPricingOptions {
  extraDailyRates: Record<RentalExtra, Money>;
  lateFeePerHour: Money;
  /** Minutes after the due time before the late fee starts. Defaults to 30. */
  graceMinutes?: number;
  /** Flat fee for dropping the car at a different store. Defaults to 0. */
  oneWayFee?: Money;
}

/**
 * Daily rate x billable days, each extra per day, a flat one-way drop fee, and
 * a late fee per started hour once the grace period is over. Early returns are
 * not refunded: the car was held for the whole booked period.
 */
export class StandardPricingStrategy implements PricingStrategy {
  private readonly graceMinutes: number;
  private readonly oneWayFee: Money;

  constructor(private readonly options: StandardPricingOptions) {
    assertMoney(options.lateFeePerHour, 'lateFeePerHour');
    this.graceMinutes = options.graceMinutes ?? 30;
    this.oneWayFee = options.oneWayFee ?? 0;
  }

  price(terms: RentalTerms, returnedAt: Date): Invoice {
    const days = terms.period.billableDays;
    const lines: LineItem[] = [
      {
        kind: LineItemKind.RENTAL,
        description: `${terms.vehicle.model}: ${days} day(s) x ${formatMoney(terms.vehicle.dailyRate)}`,
        amount: days * terms.vehicle.dailyRate,
      },
    ];
    for (const extra of terms.extras) {
      lines.push({
        kind: LineItemKind.EXTRA,
        description: `${extra}: ${days} day(s)`,
        amount: days * this.options.extraDailyRates[extra],
      });
    }
    if (terms.pickupStoreId !== terms.returnStoreId && this.oneWayFee > 0) {
      lines.push({ kind: LineItemKind.ONE_WAY_FEE, description: `One-way drop at ${terms.returnStoreId}`, amount: this.oneWayFee });
    }
    const lateHours = this.lateHours(terms.period.end, returnedAt);
    if (lateHours > 0) {
      lines.push({
        kind: LineItemKind.LATE_FEE,
        description: `Late return: ${lateHours} hour(s)`,
        amount: lateHours * this.options.lateFeePerHour,
      });
    }
    return new Invoice(lines);
  }

  private lateHours(due: Date, returnedAt: Date): number {
    const lateMinutes = (returnedAt.getTime() - due.getTime()) / 60_000;
    return lateMinutes > this.graceMinutes ? Math.ceil(lateMinutes / 60) : 0;
  }
}

/**
 * Decorator: wraps any PricingStrategy and takes a percentage off the rental
 * days of long bookings. Extras and penalties stay at full price.
 */
export class LongRentalDiscount implements PricingStrategy {
  constructor(
    private readonly inner: PricingStrategy,
    private readonly minDays: number,
    private readonly percentOff: number,
  ) {
    if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
      throw new RangeError(`percentOff must be an integer 0-100, got ${percentOff}`);
    }
  }

  price(terms: RentalTerms, returnedAt: Date): Invoice {
    const invoice = this.inner.price(terms, returnedAt);
    if (terms.period.billableDays < this.minDays) return invoice;
    const discount = Math.floor((invoice.amountOf(LineItemKind.RENTAL) * this.percentOff) / 100);
    return new Invoice([
      ...invoice.lines,
      { kind: LineItemKind.DISCOUNT, description: `${this.percentOff}% off ${this.minDays}+ day rentals`, amount: -discount },
    ]);
  }
}
