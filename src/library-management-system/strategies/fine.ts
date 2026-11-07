import { assertMoney, type Money } from '../../shared/money';
import type { Loan } from '../loan';

/**
 * Strategy pattern: how lateness is priced is library policy, and it differs
 * by member type (children, staff) or by item (reference books, DVDs).
 */
export interface FineStrategy {
  calculate(loan: Loan, returnedAt: Date): Money;
}

/** A flat amount per started day late, capped so a forgotten book never costs more than `cap`. */
export class PerDayCappedFineStrategy implements FineStrategy {
  constructor(
    private readonly perDay: Money,
    private readonly cap: Money,
    private readonly graceDays = 0,
  ) {
    assertMoney(perDay, 'perDay');
    assertMoney(cap, 'cap');
  }

  calculate(loan: Loan, returnedAt: Date): Money {
    const chargeableDays = Math.max(0, loan.daysOverdue(returnedAt) - this.graceDays);
    return Math.min(chargeableDays * this.perDay, this.cap);
  }
}

/** For cards that are never fined, such as staff or children's memberships. */
export class NoFineStrategy implements FineStrategy {
  calculate(): Money {
    return 0;
  }
}
