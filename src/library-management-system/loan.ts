import { assertMoney, type Money } from '../shared/money';
import { InvalidTransitionError, RenewalLimitReachedError } from './errors';

const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export enum LoanStatus {
  ACTIVE = 'ACTIVE',
  RETURNED = 'RETURNED',
  LOST = 'LOST',
}

/**
 * One member holding one copy until a due date. Rules that need only the
 * loan's own data (renewal count, lateness) live here; the rule that needs
 * other members' holds lives in Library.
 */
export class Loan {
  private _status = LoanStatus.ACTIVE;
  private _dueAt: Date;
  private _renewals = 0;
  private _closedAt: Date | null = null;
  private _charge: Money = 0;

  constructor(
    readonly id: string,
    readonly barcode: string,
    readonly isbn: string,
    readonly memberId: string,
    readonly borrowedAt: Date,
    dueAt: Date,
  ) {
    this._dueAt = new Date(dueAt);
  }

  get status(): LoanStatus {
    return this._status;
  }

  get dueAt(): Date {
    return new Date(this._dueAt);
  }

  get renewals(): number {
    return this._renewals;
  }

  get closedAt(): Date | null {
    return this._closedAt;
  }

  /** Fine or replacement fee charged when the loan closed. */
  get charge(): Money {
    return this._charge;
  }

  /** Started days late: returning one minute after the due time counts as one day. */
  daysOverdue(at: Date): number {
    return Math.max(0, Math.ceil((at.getTime() - this._dueAt.getTime()) / DAY_MS));
  }

  /** Extends from the current due date, not from today, so renewing early never shortens a loan. */
  renew(extendByDays: number, maxRenewals: number): void {
    this.assertActive('RENEW');
    if (this._renewals >= maxRenewals) throw new RenewalLimitReachedError(this.id, maxRenewals);
    this._dueAt = addDays(this._dueAt, extendByDays);
    this._renewals += 1;
  }

  /** Closes the loan exactly once, so a copy is never returned (or charged) twice. */
  close(outcome: LoanStatus.RETURNED | LoanStatus.LOST, at: Date, charge: Money): void {
    this.assertActive(`close as ${outcome}`);
    assertMoney(charge, 'charge');
    this._status = outcome;
    this._closedAt = at;
    this._charge = charge;
  }

  private assertActive(attempted: string): void {
    if (this._status !== LoanStatus.ACTIVE) throw new InvalidTransitionError('Loan', this.id, this._status, attempted);
  }
}
