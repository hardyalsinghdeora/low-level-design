import type { Money } from '../shared/money';
import { Account, AccountType } from './account';
import { AccountNotFoundError, InvalidAmountError, LedgerIntegrityError, UnbalancedPostingError } from './errors';
import { EntryDirection, LedgerEntry, type PostingLine } from './ledger-entry';

export interface TrialBalance {
  debits: Money;
  credits: Money;
}

/**
 * Double-entry ledger, the single source of truth for money. A posting is
 * validated as a whole (balanced, positive amounts, known accounts, no
 * overdraft) before the first entry is written, so it is all-or-nothing.
 */
export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly allEntries: LedgerEntry[] = [];
  private readonly entriesByTransaction = new Map<string, LedgerEntry[]>();

  openAccount(id: string, type: AccountType, ownerId: string | null = null): Account {
    if (this.accounts.has(id)) throw new RangeError(`Account ${id} already exists`);
    const account = new Account(id, type, ownerId);
    this.accounts.set(id, account);
    return account;
  }

  account(id: string): Account {
    const account = this.accounts.get(id);
    if (!account) throw new AccountNotFoundError(id);
    return account;
  }

  get entries(): readonly LedgerEntry[] {
    return this.allEntries;
  }

  entriesFor(transactionId: string): readonly LedgerEntry[] {
    return this.entriesByTransaction.get(transactionId) ?? [];
  }

  post(transactionId: string, lines: readonly PostingLine[], postedAt: Date): readonly LedgerEntry[] {
    if (this.entriesByTransaction.has(transactionId)) {
      throw new RangeError(`Transaction ${transactionId} is already posted`);
    }
    let debits = 0;
    let credits = 0;
    const deltas = new Map<Account, Money>();
    for (const line of lines) {
      if (!Number.isInteger(line.amount) || line.amount <= 0) throw new InvalidAmountError(line.amount);
      const account = this.account(line.accountId);
      if (line.direction === EntryDirection.DEBIT) debits += line.amount;
      else credits += line.amount;
      deltas.set(account, (deltas.get(account) ?? 0) + account.effectOf(line.direction, line.amount));
    }
    if (lines.length < 2 || debits !== credits) throw new UnbalancedPostingError(transactionId, debits, credits);
    for (const [account, delta] of deltas) account.assertCanApply(delta);

    // Everything is validated; nothing below can throw, which is what makes the posting atomic.
    for (const [account, delta] of deltas) account.apply(delta);
    const posted = lines.map(
      (line, index) =>
        new LedgerEntry(`${transactionId}/${index + 1}`, transactionId, line.accountId, line.direction, line.amount, postedAt),
    );
    this.allEntries.push(...posted);
    this.entriesByTransaction.set(transactionId, posted);
    return posted;
  }

  trialBalance(): TrialBalance {
    let debits = 0;
    let credits = 0;
    for (const entry of this.allEntries) {
      if (entry.direction === EntryDirection.DEBIT) debits += entry.amount;
      else credits += entry.amount;
    }
    return { debits, credits };
  }

  /** Recomputes a balance from the entries alone, ignoring the cached value. */
  derivedBalance(accountId: string): Money {
    const account = this.account(accountId);
    return this.allEntries
      .filter((entry) => entry.accountId === accountId)
      .reduce((sum, entry) => sum + account.effectOf(entry.direction, entry.amount), 0);
  }

  /**
   * Reconciliation: entries sum to zero and every cached balance equals the one
   * derived from entries. Tests run it after every scenario; production runs it
   * as a scheduled job and pages someone if it ever throws.
   */
  verify(): void {
    const signedSum = this.allEntries.reduce((sum, entry) => sum + entry.signedAmount, 0);
    if (signedSum !== 0) throw new LedgerIntegrityError(`Entries sum to ${signedSum}, expected 0`);
    for (const account of this.accounts.values()) {
      const derived = this.derivedBalance(account.id);
      if (derived !== account.balance) {
        throw new LedgerIntegrityError(`Account ${account.id} caches ${account.balance} but its entries give ${derived}`);
      }
    }
  }
}
