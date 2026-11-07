import type { Money } from '../shared/money';
import { SplitMismatchError } from './errors';
import { lineAmount, type Order } from './order';
import type { ServiceChargeStrategy, TaxStrategy } from './strategies/charges';

export interface BillLine {
  readonly lineId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly amount: Money;
}

/**
 * Splits `total` in proportion to `weights` with the largest-remainder method:
 * every share is an integer, the shares always add up to `total`, and leftover
 * paise go to the largest fractions (ties to the earlier share).
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError('at least one share is required');
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum === 0 ? weights.map(() => 1) : weights;
  const effectiveSum = sum === 0 ? weights.length : sum;
  const exact = effective.map((w) => (total * w) / effectiveSum);
  const shares = exact.map(Math.floor);
  let remainder = total - shares.reduce((a, b) => a + b, 0);
  const byFraction = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFraction) {
    if (remainder === 0) break;
    shares[i] += 1;
    remainder -= 1;
  }
  return shares;
}

/**
 * An immutable bill for a served order. Service charge is on the subtotal and
 * tax on subtotal plus service, the common Indian GST treatment; both are
 * strategies so other rules plug in.
 */
export class Bill {
  readonly lines: readonly BillLine[];
  readonly subtotal: Money;

  private constructor(
    readonly orderId: string,
    lines: readonly BillLine[],
    readonly serviceCharge: Money,
    readonly tax: Money,
  ) {
    this.lines = lines;
    this.subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  }

  static for(order: Order, tax: TaxStrategy, service: ServiceChargeStrategy): Bill {
    const lines = order.lines.map((l) => ({ lineId: l.id, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, amount: lineAmount(l) }));
    const serviceCharge = service.chargeOn(order.subtotal, order.partySize);
    return new Bill(order.id, lines, serviceCharge, tax.taxOn(order.subtotal + serviceCharge));
  }

  get total(): Money {
    return this.subtotal + this.serviceCharge + this.tax;
  }

  splitEqually(ways: number): Money[] {
    if (!Number.isInteger(ways) || ways < 1) throw new SplitMismatchError(`Cannot split ${ways} ways`);
    return allocate(this.total, new Array<number>(ways).fill(1));
  }

  /**
   * Each diner pays for their own lines plus a share of service and tax in
   * proportion to what they ordered. Every line must be claimed exactly once.
   */
  splitByItems(claims: Readonly<Record<string, readonly string[]>>): Record<string, Money> {
    const owner = new Map<string, string>();
    for (const [diner, lineIds] of Object.entries(claims)) {
      for (const lineId of lineIds) {
        if (!this.lines.some((l) => l.lineId === lineId)) throw new SplitMismatchError(`Unknown line ${lineId}`);
        if (owner.has(lineId)) throw new SplitMismatchError(`Line ${lineId} is claimed twice`);
        owner.set(lineId, diner);
      }
    }
    const unclaimed = this.lines.filter((l) => !owner.has(l.lineId));
    if (unclaimed.length > 0) throw new SplitMismatchError(`Unclaimed lines: ${unclaimed.map((l) => l.name).join(', ')}`);

    const diners = Object.keys(claims);
    const own = diners.map((d) => this.lines.filter((l) => owner.get(l.lineId) === d).reduce((sum, l) => sum + l.amount, 0));
    const extras = allocate(this.serviceCharge + this.tax, own);
    return Object.fromEntries(diners.map((d, i) => [d, own[i] + extras[i]]));
  }
}
