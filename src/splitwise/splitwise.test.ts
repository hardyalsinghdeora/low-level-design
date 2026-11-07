import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  allocateByWeights,
  BalanceSheet,
  DuplicateUserError,
  ExpenseEventType,
  ExpenseNotFoundError,
  GreedyMinCashFlowSimplifier,
  GroupNotFoundError,
  InvalidAmountError,
  InvalidSettlementError,
  InvalidSplitError,
  NotAGroupMemberError,
  PairwiseDebtSimplifier,
  SplitType,
  Splitwise,
  StaleExpenseError,
  UserNotFoundError,
  type DebtSimplifier,
  type ExpenseEvent,
  type ExpenseInput,
} from './index';

function build(simplifier?: DebtSimplifier) {
  const app = new Splitwise({ clock: new FakeClock('2026-03-01T09:00:00Z'), ids: new SequentialIdGenerator(), simplifier });
  for (const id of ['a', 'b', 'c', 'd']) app.addUser(id, id.toUpperCase());
  const group = app.createGroup('Trip', ['a', 'b', 'c', 'd']);
  return { app, group };
}

const equal = (paidBy: string, amount: number, ids: string[], groupId?: string): ExpenseInput => ({
  description: 'x', paidBy, amount, splitType: SplitType.EQUAL, entries: ids.map((userId) => ({ userId })), groupId,
});
const valued = (splitType: SplitType, paidBy: string, amount: number, values: Record<string, number>): ExpenseInput => ({
  description: 'x', paidBy, amount, splitType, entries: Object.entries(values).map(([userId, value]) => ({ userId, value })),
});

/** Deterministic pseudo-random numbers (LCG) for the property test. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
}

describe('splits', () => {
  it('allocates rounding remainders deterministically: 100 three ways is 34, 33, 33', () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    const { app } = build();
    const expense = app.addExpense(equal('a', 100, ['a', 'b', 'c']));
    expect([...expense.shares.values()]).toEqual([34, 33, 33]);
    expect(app.balanceSheet().owes('b', 'a')).toBe(33);
    expect(app.netBalance('a')).toBe(66);
  });

  it('EXACT accepts shares that sum to the total and rejects any that do not', () => {
    const { app } = build();
    const ok = app.addExpense(valued(SplitType.EXACT, 'a', 1_000, { a: 200, b: 800 }));
    expect(ok.shareOf('b')).toBe(800);
    expect(() => app.addExpense(valued(SplitType.EXACT, 'a', 1_000, { a: 200, b: 700 }))).toThrow(InvalidSplitError);
    expect(() => app.addExpense(valued(SplitType.EXACT, 'a', 1_000, { a: 200.5, b: 799.5 }))).toThrow(InvalidSplitError);
  });

  it('PERCENT works in basis points: 33.33/33.33/33.34 of 1000 is 333, 333, 334', () => {
    const { app } = build();
    const expense = app.addExpense(valued(SplitType.PERCENT, 'a', 1_000, { a: 33.33, b: 33.33, c: 33.34 }));
    expect([...expense.shares.values()]).toEqual([333, 333, 334]);
    expect(() => app.addExpense(valued(SplitType.PERCENT, 'a', 1_000, { a: 50, b: 49 }))).toThrow(/99%/);
    expect(() => app.addExpense(valued(SplitType.PERCENT, 'a', 1_000, { a: 50.005, b: 49.995 }))).toThrow(InvalidSplitError);
  });

  it('SHARES divides in proportion and rejects non-positive weights', () => {
    const { app } = build();
    const expense = app.addExpense(valued(SplitType.SHARES, 'a', 601, { a: 1, b: 2, c: 3 }));
    expect([...expense.shares.values()]).toEqual([100, 200, 301]);
    expect(() => app.addExpense(valued(SplitType.SHARES, 'a', 600, { a: 0, b: 2 }))).toThrow(InvalidSplitError);
  });

  it('rejects empty, duplicate and value-less splits and non-positive amounts', () => {
    const { app } = build();
    expect(() => app.addExpense(equal('a', 100, []))).toThrow(InvalidSplitError);
    expect(() => app.addExpense(equal('a', 100, ['b', 'b']))).toThrow(/twice/);
    expect(() => app.addExpense({ ...equal('a', 100, ['b']), splitType: SplitType.EXACT })).toThrow(/needs a value/);
    expect(() => app.addExpense(equal('a', 0, ['a', 'b']))).toThrow(InvalidAmountError);
    expect(() => app.addExpense(equal('a', 10.5, ['a', 'b']))).toThrow(InvalidAmountError);
  });
});

describe('balances', () => {
  it('nets pairwise debts in both directions', () => {
    const sheet = new BalanceSheet();
    sheet.record('b', 'a', 100);
    sheet.record('a', 'b', 40);
    expect(sheet.debts()).toEqual([{ from: 'b', to: 'a', amount: 60 }]);
    sheet.record('a', 'b', 60);
    expect(sheet.isSettled).toBe(true);
  });

  it('editing an expense recomputes balances, and a stale version is rejected', () => {
    const { app } = build();
    const expense = app.addExpense(equal('a', 300, ['a', 'b', 'c']));
    const edited = app.editExpense(expense.id, equal('a', 600, ['a', 'b']), 1);
    expect(edited.version).toBe(2);
    expect(app.netBalance('a')).toBe(300);
    expect(app.netBalance('c')).toBe(0);
    expect(() => app.editExpense(expense.id, equal('a', 900, ['a', 'b']), 1)).toThrow(StaleExpenseError);
  });

  it('deleting an expense removes its effect entirely', () => {
    const { app } = build();
    const expense = app.addExpense(equal('a', 300, ['a', 'b', 'c']));
    app.addExpense(equal('b', 100, ['a', 'b']));
    app.deleteExpense(expense.id);
    expect(app.balanceSheet().debts()).toEqual([{ from: 'a', to: 'b', amount: 50 }]);
    expect(() => app.deleteExpense(expense.id)).toThrow(ExpenseNotFoundError);
  });

  it('keeps group balances separate from the overall view and enforces membership', () => {
    const { app, group } = build();
    app.addUser('e', 'E');
    app.addExpense(equal('a', 200, ['a', 'b'], group.id));
    app.addExpense(equal('a', 400, ['a', 'e']));
    expect(app.netBalance('a', group.id)).toBe(100);
    expect(app.netBalance('a')).toBe(300);
    expect(() => app.addExpense(equal('a', 200, ['a', 'e'], group.id))).toThrow(NotAGroupMemberError);
    expect(() => app.balanceSheet('group-404')).toThrow(GroupNotFoundError);
    expect(() => app.addExpense(equal('zed', 200, ['a']))).toThrow(UserNotFoundError);
    expect(() => app.addUser('a', 'Again')).toThrow(DuplicateUserError);
  });
});

describe('simplification and settle-up', () => {
  function chain(app: Splitwise, groupId: string) {
    app.addExpense(equal('a', 400, ['a', 'b', 'c', 'd'], groupId)); // b, c, d owe a 100 each
    app.addExpense(equal('b', 200, ['c', 'd'], groupId)); // c, d owe b 100 each
    app.addExpense(valued(SplitType.EXACT, 'c', 300, { d: 300 })); // overall only
  }

  it('greedy min-cash-flow reduces six pairwise debts to three payments and preserves every net', () => {
    const { app, group } = build();
    chain(app, group.id);
    const sheet = app.balanceSheet();
    expect(sheet.debts()).toHaveLength(6);
    const plan = app.suggestedPayments();
    expect(plan).toEqual([
      { from: 'd', to: 'a', amount: 300 },
      { from: 'd', to: 'b', amount: 100 },
      { from: 'd', to: 'c', amount: 100 },
    ]);
    const replay = new BalanceSheet();
    plan.forEach((p) => replay.record(p.to, p.from, p.amount)); // paying the plan must cancel the nets
    sheet.netBalances().forEach((net, user) => expect(net + replay.netBalance(user)).toBe(0));
    expect(new Splitwise().suggestedPayments()).toEqual([]);
    expect(build(new PairwiseDebtSimplifier()).app.suggestedPayments()).toEqual([]);
  });

  it('preserves nets and needs at most n - 1 payments on random ledgers', () => {
    const rng = lcg(42);
    const users = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let round = 0; round < 25; round += 1) {
      const sheet = new BalanceSheet();
      for (let i = 0; i < 12; i += 1) {
        const from = users[Math.floor(rng() * users.length)];
        const to = users[Math.floor(rng() * users.length)];
        sheet.record(from, to, Math.floor(rng() * 10_000));
      }
      const plan = new GreedyMinCashFlowSimplifier().simplify(sheet);
      const after = new BalanceSheet();
      sheet.debts().forEach((d) => after.record(d.from, d.to, d.amount));
      plan.forEach((p) => after.record(p.to, p.from, p.amount));
      expect(after.isSettled).toBe(true);
      expect(plan.length).toBeLessThanOrEqual(Math.max(0, sheet.netBalances().size - 1));
    }
  });

  it('settle-up reduces balances and rejects overpayment, self-payment and bad amounts', () => {
    const { app, group } = build();
    chain(app, group.id);
    app.settleUp('d', 'a', 300);
    expect(app.netBalance('d')).toBe(-200);
    expect(app.netBalance('a')).toBe(0);
    expect(() => app.settleUp('d', 'b', 150)).toThrow(InvalidSettlementError);
    expect(() => app.settleUp('b', 'b', 10)).toThrow(InvalidSettlementError);
    expect(() => app.settleUp('d', 'b', 0)).toThrow(InvalidAmountError);
    app.settleUp('d', 'b', 100);
    app.settleUp('d', 'c', 100);
    expect(app.balanceSheet().isSettled).toBe(true);
  });
});

describe('observer', () => {
  it('notifies listeners of added, updated and deleted expenses until they unsubscribe', () => {
    const { app } = build();
    const seen: ExpenseEvent[] = [];
    const unsubscribe = app.subscribe({ onExpenseEvent: (event) => seen.push(event) });
    const expense = app.addExpense(equal('a', 100, ['a', 'b']));
    app.editExpense(expense.id, equal('a', 200, ['a', 'b']));
    unsubscribe();
    app.deleteExpense(expense.id);
    expect(seen.map((e) => `${e.type}:v${e.expense.version}`)).toEqual([`${ExpenseEventType.ADDED}:v1`, `${ExpenseEventType.UPDATED}:v2`]);
  });
});
