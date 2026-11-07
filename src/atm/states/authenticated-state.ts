import type { Money } from '../../shared/money';
import type { Transaction } from '../account';
import type { Card } from '../card';
import { InvalidDenominationError } from '../errors';
import { AtmState, BaseAtmState, type WithdrawalReceipt } from './atm-state';

/** PIN verified: banking operations are allowed until the card is ejected. */
export class AuthenticatedState extends BaseAtmState {
  readonly name = AtmState.AUTHENTICATED;

  /**
   * Debit first, then dispense. If the cash module cannot pay out (no cash,
   * amount not makeable, jam), the debit is reversed with a compensating
   * entry, so the customer is never charged for cash they did not get.
   */
  override withdraw(amount: Money): WithdrawalReceipt {
    const accountId = this.requireAccount();
    const transaction = this.atm.bank.withdraw(accountId, amount, this.atm.nextRequestId());
    try {
      const notes = this.atm.dispenser.dispense(amount);
      return { transaction, notes, balance: transaction.balanceAfter };
    } catch (error) {
      this.atm.bank.reverse(transaction.id);
      throw error;
    }
  }

  /** Deposited notes go to the deposit bin, not the dispensing cassettes. */
  override deposit(notes: Readonly<Record<number, number>>): Transaction {
    let total = 0;
    for (const [denomination, count] of Object.entries(notes)) {
      const d = Number(denomination);
      if (!this.atm.dispenser.inventory().has(d)) throw new InvalidDenominationError(d);
      total += d * count;
    }
    return this.atm.bank.deposit(this.requireAccount(), total, this.atm.nextRequestId());
  }

  override balance(): Money {
    return this.atm.bank.balance(this.requireAccount());
  }

  override miniStatement(last: number): Transaction[] {
    return this.atm.bank.statement(this.requireAccount(), last);
  }

  override ejectCard(): Card {
    const card = this.atm.endSession();
    this.atm.transition(AtmState.IDLE);
    if (!card) throw new RangeError('Authenticated state without a card');
    return card;
  }

  private requireAccount(): string {
    const id = this.atm.accountId();
    if (!id) throw new RangeError('Authenticated state without an account');
    return id;
  }
}
