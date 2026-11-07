import type { Expense } from './expense';

export enum ExpenseEventType {
  ADDED = 'ADDED',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
}

export interface ExpenseEvent {
  readonly type: ExpenseEventType;
  readonly expense: Expense;
}

/** Observer: notifications, activity feeds and cached balances react to expense changes without the service knowing them. */
export interface ExpenseListener {
  onExpenseEvent(event: ExpenseEvent): void;
}
