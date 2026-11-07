import { SystemClock, type Clock } from '../shared/clock';
import { UuidGenerator, type IdGenerator } from '../shared/id-generator';
import { formatMoney, type Money } from '../shared/money';
import { BalanceSheet, type Debt } from './balance-sheet';
import {
  DuplicateUserError,
  ExpenseNotFoundError,
  GroupNotFoundError,
  InvalidAmountError,
  InvalidSettlementError,
  InvalidSplitError,
  StaleExpenseError,
  UserNotFoundError,
} from './errors';
import { ExpenseEventType, type ExpenseListener } from './events';
import { Expense } from './expense';
import { Group } from './group';
import { Settlement } from './settlement';
import { GreedyMinCashFlowSimplifier, type DebtSimplifier } from './strategies/debt-simplifier';
import { defaultSplitStrategies, type SplitEntry, type SplitStrategy, type SplitType } from './strategies/split';
import { User } from './user';

export interface ExpenseInput {
  description: string;
  paidBy: string;
  amount: Money;
  splitType: SplitType;
  entries: readonly SplitEntry[];
  groupId?: string;
}

export interface SplitwiseOptions {
  clock?: Clock;
  ids?: IdGenerator;
  splitStrategies?: readonly SplitStrategy[];
  simplifier?: DebtSimplifier;
}

/**
 * Aggregate root. Expenses and settlements are the source of truth; balances are
 * always derived from them, so editing or deleting an expense can never leave a
 * stale balance behind.
 */
export class Splitwise {
  private readonly users = new Map<string, User>();
  private readonly groups = new Map<string, Group>();
  private readonly expenses = new Map<string, Expense>();
  private readonly settlements: Settlement[] = [];
  private readonly listeners = new Set<ExpenseListener>();
  private readonly strategies = new Map<SplitType, SplitStrategy>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly simplifier: DebtSimplifier;

  constructor(options: SplitwiseOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.simplifier = options.simplifier ?? new GreedyMinCashFlowSimplifier();
    for (const strategy of options.splitStrategies ?? defaultSplitStrategies()) this.strategies.set(strategy.type, strategy);
  }

  addUser(id: string, name: string): User {
    if (this.users.has(id)) throw new DuplicateUserError(id);
    const user = new User(id, name);
    this.users.set(id, user);
    return user;
  }

  user(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  }

  createGroup(name: string, memberIds: readonly string[]): Group {
    memberIds.forEach((id) => this.user(id));
    const group = new Group(this.ids.next('group'), name, memberIds);
    this.groups.set(group.id, group);
    return group;
  }

  group(id: string): Group {
    const group = this.groups.get(id);
    if (!group) throw new GroupNotFoundError(id);
    return group;
  }

  subscribe(listener: ExpenseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addExpense(input: ExpenseInput): Expense {
    const expense = this.buildExpense(this.ids.next('exp'), input, 1, this.clock.now());
    this.expenses.set(expense.id, expense);
    this.emit(ExpenseEventType.ADDED, expense);
    return expense;
  }

  /** Replaces the expense with a new version. Pass `expectedVersion` to reject edits made from a stale copy. */
  editExpense(id: string, input: ExpenseInput, expectedVersion?: number): Expense {
    const current = this.expense(id);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new StaleExpenseError(id, expectedVersion, current.version);
    }
    const next = this.buildExpense(id, input, current.version + 1, current.createdAt);
    this.expenses.set(id, next);
    this.emit(ExpenseEventType.UPDATED, next);
    return next;
  }

  deleteExpense(id: string): void {
    const expense = this.expense(id);
    this.expenses.delete(id);
    this.emit(ExpenseEventType.DELETED, expense);
  }

  expense(id: string): Expense {
    const expense = this.expenses.get(id);
    if (!expense) throw new ExpenseNotFoundError(id);
    return expense;
  }

  /**
   * Records a payment. It is checked against net balances in the chosen scope, so
   * paying along a simplified plan (Dev pays Asha though he owed Ravi) is allowed,
   * but no one can pay more than they owe or more than the receiver is owed.
   */
  settleUp(from: string, to: string, amount: Money, groupId?: string): Settlement {
    this.user(from);
    this.user(to);
    if (groupId !== undefined) this.group(groupId).assertMembers([from, to]);
    const settlement = new Settlement(this.ids.next('pay'), from, to, amount, groupId, this.clock.now());
    const sheet = this.balanceSheet(groupId);
    const fromOwes = Math.max(0, -sheet.netBalance(from));
    const toIsOwed = Math.max(0, sheet.netBalance(to));
    if (amount > Math.min(fromOwes, toIsOwed)) {
      throw new InvalidSettlementError(
        `${from} owes ${formatMoney(fromOwes)} and ${to} is owed ${formatMoney(toIsOwed)}; cannot settle ${formatMoney(amount)}`,
      );
    }
    this.settlements.push(settlement);
    return settlement;
  }

  /** Group scope when `groupId` is given, otherwise everything (group and non-group expenses together). */
  balanceSheet(groupId?: string): BalanceSheet {
    if (groupId !== undefined) this.group(groupId);
    const inScope = (scope: string | undefined) => groupId === undefined || scope === groupId;
    const sheet = new BalanceSheet();
    for (const expense of this.expenses.values()) {
      if (inScope(expense.groupId)) expense.debts().forEach((d) => sheet.record(d.from, d.to, d.amount));
    }
    for (const s of this.settlements) if (inScope(s.groupId)) sheet.record(s.to, s.from, s.amount);
    return sheet;
  }

  netBalance(userId: string, groupId?: string): Money {
    this.user(userId);
    return this.balanceSheet(groupId).netBalance(userId);
  }

  suggestedPayments(groupId?: string): Debt[] {
    return this.simplifier.simplify(this.balanceSheet(groupId));
  }

  private buildExpense(id: string, input: ExpenseInput, version: number, createdAt: Date): Expense {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new InvalidAmountError(input.amount);
    const strategy = this.strategies.get(input.splitType);
    if (!strategy) throw new InvalidSplitError(`No split strategy registered for ${input.splitType}`);
    this.user(input.paidBy);
    input.entries.forEach((entry) => this.user(entry.userId));
    if (input.groupId !== undefined) {
      this.group(input.groupId).assertMembers([input.paidBy, ...input.entries.map((entry) => entry.userId)]);
    }
    const shares = strategy.split(input.amount, input.entries);
    return new Expense(id, input.description, input.paidBy, input.amount, input.splitType, shares, input.groupId, createdAt, version);
  }

  private emit(type: ExpenseEventType, expense: Expense): void {
    for (const listener of this.listeners) listener.onExpenseEvent({ type, expense });
  }
}
