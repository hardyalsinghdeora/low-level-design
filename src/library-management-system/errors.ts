import { DomainError } from '../shared/errors';
import { formatMoney, type Money } from '../shared/money';

export class LibraryError extends DomainError {}

export class BookNotFoundError extends LibraryError {
  constructor(isbn: string) {
    super(`No book with ISBN ${isbn} in the catalog`);
  }
}

export class CopyNotFoundError extends LibraryError {
  constructor(barcode: string) {
    super(`No copy with barcode ${barcode}`);
  }
}

export class MemberNotFoundError extends LibraryError {
  constructor(memberId: string) {
    super(`No member ${memberId}`);
  }
}

export class NoActiveLoanError extends LibraryError {
  constructor(barcode: string) {
    super(`Copy ${barcode} is not on loan`);
  }
}

/** One error for every state machine in this module: copies, loans, holds and memberships. */
export class InvalidTransitionError extends LibraryError {
  constructor(entity: string, id: string, state: string, attempted: string) {
    super(`${entity} ${id} cannot ${attempted} while ${state}`);
  }
}

export class CopyNotAvailableError extends LibraryError {
  constructor(barcode: string, status: string) {
    super(`Copy ${barcode} is ${status} and cannot be lent to this member`);
  }
}

export class MembershipNotActiveError extends LibraryError {
  constructor(memberId: string, status: string) {
    super(`Member ${memberId} is ${status}`);
  }
}

export class BorrowLimitReachedError extends LibraryError {
  constructor(memberId: string, limit: number) {
    super(`Member ${memberId} already has ${limit} loan(s), the limit`);
  }
}

export class OutstandingFinesError extends LibraryError {
  constructor(memberId: string, owed: Money) {
    super(`Member ${memberId} owes ${formatMoney(owed)} in fines`);
  }
}

export class RenewalLimitReachedError extends LibraryError {
  constructor(loanId: string, maxRenewals: number) {
    super(`Loan ${loanId} has already been renewed ${maxRenewals} time(s)`);
  }
}

export class RenewalBlockedByHoldError extends LibraryError {
  constructor(loanId: string, isbn: string) {
    super(`Loan ${loanId} cannot be renewed: another member is waiting for ${isbn}`);
  }
}

export class DuplicateHoldError extends LibraryError {
  constructor(memberId: string, isbn: string) {
    super(`Member ${memberId} already has an active hold on ${isbn}`);
  }
}
