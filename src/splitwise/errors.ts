import { DomainError } from '../shared/errors';

export class SplitwiseError extends DomainError {}

export class InvalidAmountError extends SplitwiseError {
  constructor(amount: number) {
    super(`Amount must be a positive integer number of paise, got ${amount}`);
  }
}

/** The split does not describe the expense: wrong sum, duplicate person, missing or bad value. */
export class InvalidSplitError extends SplitwiseError {}

export class UserNotFoundError extends SplitwiseError {
  constructor(userId: string) {
    super(`No user ${userId}`);
  }
}

export class GroupNotFoundError extends SplitwiseError {
  constructor(groupId: string) {
    super(`No group ${groupId}`);
  }
}

export class ExpenseNotFoundError extends SplitwiseError {
  constructor(expenseId: string) {
    super(`No expense ${expenseId}`);
  }
}

export class NotAGroupMemberError extends SplitwiseError {
  constructor(userId: string, groupId: string) {
    super(`User ${userId} is not a member of group ${groupId}`);
  }
}

export class InvalidSettlementError extends SplitwiseError {}

export class DuplicateUserError extends SplitwiseError {
  constructor(userId: string) {
    super(`User ${userId} already exists`);
  }
}

/** Optimistic concurrency: the caller edited a version of the expense that is no longer current. */
export class StaleExpenseError extends SplitwiseError {
  constructor(expenseId: string, expected: number, actual: number) {
    super(`Expense ${expenseId} is at version ${actual}, not ${expected}; reload and retry`);
  }
}
