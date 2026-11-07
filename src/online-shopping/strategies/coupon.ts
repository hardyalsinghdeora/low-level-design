import { assertMoney, formatMoney, type Money } from '../../shared/money';
import { CouponNotApplicableError, CouponStackingError } from '../errors';

/** Strategy: one way of taking money off a total. */
export interface Coupon {
  readonly code: string;
  /** A non-stackable coupon must be the only one on the order. */
  readonly stackable: boolean;
  /** Lower runs first. Flat amounts run before percentages, so a percentage never discounts money already given away. */
  readonly applyOrder: number;
  /** Discount on the running `amount`; never more than it. `subtotal` is the pre-discount total for thresholds. */
  discountOn(amount: Money, subtotal: Money): Money;
}

export interface CouponOptions {
  stackable?: boolean;
  minSubtotal?: Money;
}

export class FlatOffCoupon implements Coupon {
  readonly applyOrder = 0;
  readonly stackable: boolean;

  constructor(
    readonly code: string,
    private readonly amount: Money,
    private readonly options: CouponOptions = {},
  ) {
    assertMoney(amount, 'amount');
    this.stackable = options.stackable ?? true;
  }

  discountOn(amount: Money, subtotal: Money): Money {
    const min = this.options.minSubtotal ?? 0;
    if (subtotal < min) throw new CouponNotApplicableError(this.code, `needs a subtotal of ${formatMoney(min)}`);
    return Math.min(this.amount, amount);
  }
}

export class PercentOffCoupon implements Coupon {
  readonly applyOrder = 1;
  readonly stackable: boolean;

  constructor(
    readonly code: string,
    private readonly percent: number,
    private readonly options: CouponOptions & { maxDiscount?: Money } = {},
  ) {
    if (!Number.isInteger(percent) || percent <= 0 || percent > 100) throw new RangeError('percent must be an integer 1-100');
    this.stackable = options.stackable ?? true;
  }

  discountOn(amount: Money, subtotal: Money): Money {
    const min = this.options.minSubtotal ?? 0;
    if (subtotal < min) throw new CouponNotApplicableError(this.code, `needs a subtotal of ${formatMoney(min)}`);
    // Round down: the shop never gives away a fraction of a paisa it cannot represent.
    const raw = Math.floor((amount * this.percent) / 100);
    return Math.min(raw, this.options.maxDiscount ?? raw);
  }
}

export interface AppliedCoupon {
  readonly code: string;
  readonly discount: Money;
}

/** The stacking rules in one place: a cap on the count, no duplicates, exclusive coupons alone, a fixed order. */
export class CouponStack {
  constructor(private readonly maxCoupons = 2) {}

  apply(subtotal: Money, coupons: readonly Coupon[]): AppliedCoupon[] {
    if (coupons.length > this.maxCoupons) throw new CouponStackingError(`at most ${this.maxCoupons} coupons per order`);
    if (new Set(coupons.map((c) => c.code)).size !== coupons.length) throw new CouponStackingError('the same coupon twice');
    const exclusive = coupons.find((c) => !c.stackable);
    if (exclusive && coupons.length > 1) throw new CouponStackingError(`${exclusive.code} cannot be combined`);

    let running = subtotal;
    return [...coupons]
      .sort((a, b) => a.applyOrder - b.applyOrder)
      .map((coupon) => {
        const discount = coupon.discountOn(running, subtotal);
        running -= discount;
        return { code: coupon.code, discount };
      });
  }
}
