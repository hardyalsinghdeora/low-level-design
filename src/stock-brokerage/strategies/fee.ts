import type { Money } from '../../shared/money';

/**
 * Brokerage commission as a function of an order's cumulative executed value.
 * Implementations must be non-decreasing in `executedNotional` and return 0 for 0:
 * the engine charges each fill fee(after) - fee(before), so partial fills add up to
 * exactly fee(total), and the fee reserved at placement always covers it.
 */
export interface FeeStrategy {
  readonly name: string;
  feeFor(executedNotional: Money): Money;
}

export class ZeroFeeStrategy implements FeeStrategy {
  readonly name = 'zero';

  feeFor(): Money {
    return 0;
  }
}

/** A flat charge per order, paid on its first fill however many fills follow. */
export class FlatFeeStrategy implements FeeStrategy {
  readonly name = 'flat';

  constructor(private readonly perOrder: Money) {}

  feeFor(executedNotional: Money): Money {
    return executedNotional > 0 ? this.perOrder : 0;
  }
}

/** Basis points of executed value, rounded up to the paisa, with a minimum per order (e.g. 0.1%, min Rs 20). */
export class PercentageFeeStrategy implements FeeStrategy {
  readonly name = 'percentage';

  constructor(
    private readonly basisPoints: number,
    private readonly minimum: Money = 0,
  ) {}

  feeFor(executedNotional: Money): Money {
    if (executedNotional <= 0) return 0;
    const proportional = Math.floor((executedNotional * this.basisPoints + 9_999) / 10_000);
    return Math.max(this.minimum, proportional);
  }
}
