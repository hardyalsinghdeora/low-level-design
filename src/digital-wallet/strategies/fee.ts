import { assertMoney, type Money } from '../../shared/money';
import type { TransactionType } from '../transaction';

/** Strategy pattern: what the platform charges for a movement. Fees are credited to the FEES account. */
export interface FeePolicy {
  feeFor(type: TransactionType, amount: Money): Money;
}

export class NoFeePolicy implements FeePolicy {
  feeFor(): Money {
    return 0;
  }
}

/**
 * A percentage in basis points (100 bp = 1%) on the listed transaction types,
 * with an optional minimum. Multiply first, divide once, round half-up to the
 * paisa: the only division in the wallet, and its rounding is explicit.
 */
export class PercentageFeePolicy implements FeePolicy {
  constructor(
    private readonly basisPoints: number,
    private readonly appliesTo: readonly TransactionType[],
    private readonly minimumFee: Money = 0,
  ) {
    if (!Number.isInteger(basisPoints) || basisPoints < 0) {
      throw new RangeError(`basisPoints must be a non-negative integer, got ${basisPoints}`);
    }
    assertMoney(minimumFee, 'minimumFee');
  }

  feeFor(type: TransactionType, amount: Money): Money {
    if (!this.appliesTo.includes(type)) return 0;
    return Math.max(this.minimumFee, Math.round((amount * this.basisPoints) / 10_000));
  }
}
