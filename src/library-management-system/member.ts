import { assertMoney, type Money } from '../shared/money';
import {
  BorrowLimitReachedError,
  InvalidTransitionError,
  MembershipNotActiveError,
  OutstandingFinesError,
} from './errors';

export enum MembershipStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  [MembershipStatus.ACTIVE]: [MembershipStatus.SUSPENDED, MembershipStatus.CLOSED],
  [MembershipStatus.SUSPENDED]: [MembershipStatus.ACTIVE, MembershipStatus.CLOSED],
  [MembershipStatus.CLOSED]: [],
};

/**
 * The borrowing rules that belong to the person rather than the copy:
 * membership state, the loan limit and unpaid fines. The library asks the
 * member before it touches a copy.
 */
export class Member {
  private _status = MembershipStatus.ACTIVE;
  private _finesOwed: Money = 0;
  private readonly loanIds = new Set<string>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly borrowLimit = 3,
  ) {
    if (!Number.isInteger(borrowLimit) || borrowLimit < 1) {
      throw new RangeError(`borrowLimit must be a positive integer, got ${borrowLimit}`);
    }
  }

  get status(): MembershipStatus {
    return this._status;
  }

  get finesOwed(): Money {
    return this._finesOwed;
  }

  get activeLoanCount(): number {
    return this.loanIds.size;
  }

  assertActive(): void {
    if (this._status !== MembershipStatus.ACTIVE) throw new MembershipNotActiveError(this.id, this._status);
  }

  /** Throws the first reason this member may not take another loan. */
  assertCanBorrow(): void {
    this.assertActive();
    if (this._finesOwed > 0) throw new OutstandingFinesError(this.id, this._finesOwed);
    if (this.loanIds.size >= this.borrowLimit) throw new BorrowLimitReachedError(this.id, this.borrowLimit);
  }

  startLoan(loanId: string): void {
    this.assertCanBorrow();
    this.loanIds.add(loanId);
  }

  endLoan(loanId: string, charge: Money): void {
    assertMoney(charge, 'charge');
    this.loanIds.delete(loanId);
    this._finesOwed += charge;
  }

  payFine(amount: Money): void {
    assertMoney(amount, 'payment');
    if (amount > this._finesOwed) throw new RangeError(`Payment exceeds the ${this._finesOwed} owed`);
    this._finesOwed -= amount;
  }

  changeStatus(next: MembershipStatus): void {
    if (!MEMBERSHIP_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidTransitionError('Member', this.id, this._status, `move to ${next}`);
    }
    this._status = next;
  }
}
