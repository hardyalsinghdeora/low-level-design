import type { Money } from '../shared/money';

export enum LineItemKind {
  RENTAL = 'RENTAL',
  EXTRA = 'EXTRA',
  ONE_WAY_FEE = 'ONE_WAY_FEE',
  LATE_FEE = 'LATE_FEE',
  DISCOUNT = 'DISCOUNT',
}

/** One row on the bill. Discounts are negative amounts so the total is a plain sum. */
export interface LineItem {
  readonly kind: LineItemKind;
  readonly description: string;
  readonly amount: Money;
}

/**
 * An itemised bill rather than a single number, so a receipt (or a dispute)
 * can show exactly which day, extra or late hour was charged.
 */
export class Invoice {
  constructor(readonly lines: readonly LineItem[]) {}

  get total(): Money {
    return this.lines.reduce((sum, line) => sum + line.amount, 0);
  }

  amountOf(kind: LineItemKind): Money {
    return this.lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amount, 0);
  }
}
