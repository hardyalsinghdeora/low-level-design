import type { Money } from '../shared/money';
import { InsufficientBalanceError } from './errors';
import { EntryDirection } from './ledger-entry';

export enum AccountType {
  /** What the platform owes one user. Credit-normal and never negative. */
  USER_WALLET = 'USER_WALLET',
  /** The platform's pooled bank account: real money held for users. Debit-normal (an asset). */
  BANK_CLEARING = 'BANK_CLEARING',
  /** Fee revenue. Credit-normal. */
  FEES = 'FEES',
}

/** The side on which an entry increases the account, as in real bookkeeping. */
const NORMAL_SIDE: Record<AccountType, EntryDirection> = {
  [AccountType.USER_WALLET]: EntryDirection.CREDIT,
  [AccountType.BANK_CLEARING]: EntryDirection.DEBIT,
  [AccountType.FEES]: EntryDirection.CREDIT,
};

/**
 * A ledger account. Its balance is a cache of the entries posted to it; the
 * Ledger can always recompute it and `Ledger.verify()` asserts the two agree.
 * The account still guards its own rule: a user wallet never goes negative.
 */
export class Account {
  private _balance: Money = 0;

  constructor(
    readonly id: string,
    readonly type: AccountType,
    /** The user who owns a wallet; null for system accounts. */
    readonly ownerId: string | null = null,
  ) {}

  get balance(): Money {
    return this._balance;
  }

  get normalSide(): EntryDirection {
    return NORMAL_SIDE[this.type];
  }

  get allowsNegativeBalance(): boolean {
    return this.type !== AccountType.USER_WALLET;
  }

  /** How one entry moves this balance: up on the normal side, down on the other. */
  effectOf(direction: EntryDirection, amount: Money): Money {
    return direction === this.normalSide ? amount : -amount;
  }

  assertCanApply(delta: Money): void {
    if (!this.allowsNegativeBalance && this._balance + delta < 0) {
      throw new InsufficientBalanceError(this.id, this._balance, -delta);
    }
  }

  /** Called by the Ledger after it has validated the whole posting. */
  apply(delta: Money): void {
    this.assertCanApply(delta);
    this._balance += delta;
  }
}
