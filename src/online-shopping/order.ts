import type { Money } from '../shared/money';
import type { CartLine } from './cart';
import { InvalidOrderTransitionError, ReturnWindowExpiredError } from './errors';
import type { AppliedCoupon } from './strategies/coupon';
import type { PaymentReceipt } from './strategies/payment';

export enum OrderStatus {
  PLACED = 'PLACED',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
};

export interface OrderLine extends CartLine {
  readonly lineTotal: Money;
  /** This line's part of the order discount, so a partial refund knows what the customer really paid. */
  readonly discountShare: Money;
}

/**
 * Splits `amount` across `weights` proportionally. Floors every share, then
 * hands the leftover minor units to the largest fractional parts (earlier
 * line first on ties), so the shares always add up to exactly `amount`.
 */
export function allocateProportionally(amount: Money, weights: readonly number[]): Money[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const shares = exact.map(Math.floor);
  let remainder = amount - shares.reduce((sum, s) => sum + s, 0);
  const byFraction = exact.map((x, i) => ({ i, fraction: x - Math.floor(x) })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const { i } of byFraction) {
    if (remainder === 0) break;
    shares[i] += 1;
    remainder -= 1;
  }
  return shares;
}

/** An order owns its lifecycle; every move goes through one transition table. */
export class Order {
  readonly lines: readonly OrderLine[];
  readonly subtotal: Money;
  readonly discount: Money;
  private _status = OrderStatus.PLACED;
  private _payment: PaymentReceipt | null = null;
  private _amountCollected: Money = 0;
  private _deliveredAt: Date | null = null;
  private readonly _history: { status: OrderStatus; at: Date }[];

  constructor(
    readonly id: string,
    readonly customerId: string,
    cartLines: readonly CartLine[],
    readonly coupons: readonly AppliedCoupon[],
    readonly placedAt: Date,
  ) {
    const totals = cartLines.map((l) => l.unitPrice * l.quantity);
    this.subtotal = totals.reduce((sum, t) => sum + t, 0);
    this.discount = coupons.reduce((sum, c) => sum + c.discount, 0);
    const shares = allocateProportionally(this.discount, totals);
    this.lines = cartLines.map((l, i) => ({ ...l, lineTotal: totals[i], discountShare: shares[i] }));
    this._history = [{ status: OrderStatus.PLACED, at: placedAt }];
  }

  get total(): Money {
    return this.subtotal - this.discount;
  }

  get status(): OrderStatus {
    return this._status;
  }

  get payment(): PaymentReceipt | null {
    return this._payment;
  }

  get amountCollected(): Money {
    return this._amountCollected;
  }

  get history(): readonly { status: OrderStatus; at: Date }[] {
    return this._history;
  }

  markPaid(receipt: PaymentReceipt, at: Date): void {
    this.moveTo(OrderStatus.PAID, at);
    this._payment = receipt;
    if (receipt.capturedNow) this._amountCollected = receipt.amount;
  }

  markShipped(at: Date): void {
    this.moveTo(OrderStatus.SHIPPED, at);
  }

  /** Cash on delivery is collected here, at the door. */
  markDelivered(at: Date): void {
    this.moveTo(OrderStatus.DELIVERED, at);
    this._deliveredAt = at;
    this._amountCollected = this.total;
  }

  /** Returns what must be refunded: whatever was actually collected. */
  cancel(at: Date): Money {
    this.moveTo(OrderStatus.CANCELLED, at);
    return this._amountCollected;
  }

  markReturned(at: Date, windowDays: number): Money {
    if (this._deliveredAt && at.getTime() - this._deliveredAt.getTime() > windowDays * 86_400_000) {
      throw new ReturnWindowExpiredError(this.id, windowDays);
    }
    this.moveTo(OrderStatus.RETURNED, at);
    return this._amountCollected;
  }

  /** Lets a caller check before a side effect (charging a card) that the move will be legal. */
  assertCanMoveTo(next: OrderStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidOrderTransitionError(this.id, this._status, next);
    }
  }

  private moveTo(next: OrderStatus, at: Date): void {
    this.assertCanMoveTo(next);
    this._status = next;
    this._history.push({ status: next, at });
  }
}
