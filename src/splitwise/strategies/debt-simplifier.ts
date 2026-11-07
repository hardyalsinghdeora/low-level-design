import type { Money } from '../../shared/money';
import type { BalanceSheet, Debt } from '../balance-sheet';

/** Turns a balance sheet into the list of payments people should make to settle it. */
export interface DebtSimplifier {
  readonly name: string;
  simplify(sheet: BalanceSheet): Debt[];
}

interface Party {
  userId: string;
  amount: Money;
}

const byAmountThenId = (a: Party, b: Party): number => b.amount - a.amount || a.userId.localeCompare(b.userId);

/**
 * Greedy min-cash-flow: only net balances matter, so repeatedly let the largest
 * debtor pay the largest creditor as much as one of them can. Each step zeroes at
 * least one person, so n people need at most n - 1 payments, and every net is
 * preserved exactly. (A true minimum is NP-hard; greedy is the standard answer.)
 */
export class GreedyMinCashFlowSimplifier implements DebtSimplifier {
  readonly name = 'greedy-min-cash-flow';

  simplify(sheet: BalanceSheet): Debt[] {
    const creditors: Party[] = [];
    const debtors: Party[] = [];
    for (const [userId, net] of sheet.netBalances()) {
      if (net > 0) creditors.push({ userId, amount: net });
      else debtors.push({ userId, amount: -net });
    }
    const payments: Debt[] = [];
    while (creditors.length > 0 && debtors.length > 0) {
      creditors.sort(byAmountThenId);
      debtors.sort(byAmountThenId);
      const creditor = creditors[0];
      const debtor = debtors[0];
      const amount = Math.min(creditor.amount, debtor.amount);
      payments.push({ from: debtor.userId, to: creditor.userId, amount });
      creditor.amount -= amount;
      debtor.amount -= amount;
      if (creditor.amount === 0) creditors.shift();
      if (debtor.amount === 0) debtors.shift();
    }
    return payments;
  }
}

/** No simplification: settle each pairwise debt as recorded. Easier to explain to users, more payments. */
export class PairwiseDebtSimplifier implements DebtSimplifier {
  readonly name = 'pairwise';

  simplify(sheet: BalanceSheet): Debt[] {
    return sheet.debts();
  }
}
