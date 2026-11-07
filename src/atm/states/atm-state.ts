import type { Clock } from '../../shared/clock';
import type { Money } from '../../shared/money';
import type { Transaction } from '../account';
import type { Card } from '../card';
import type { CashDispenser, NoteBundle } from '../cash-dispenser';
import { InvalidAtmOperationError, InvalidAtmTransitionError } from '../errors';
import type { BankService } from '../services/bank-service';

export enum AtmState {
  IDLE = 'IDLE',
  CARD_INSERTED = 'CARD_INSERTED',
  AUTHENTICATED = 'AUTHENTICATED',
}

const ALLOWED: Record<AtmState, readonly AtmState[]> = {
  [AtmState.IDLE]: [AtmState.CARD_INSERTED],
  [AtmState.CARD_INSERTED]: [AtmState.IDLE, AtmState.AUTHENTICATED],
  [AtmState.AUTHENTICATED]: [AtmState.IDLE],
};

export function assertAtmTransition(from: AtmState, to: AtmState): void {
  if (!ALLOWED[from].includes(to)) throw new InvalidAtmTransitionError(from, to);
}

export interface WithdrawalReceipt {
  transaction: Transaction;
  notes: NoteBundle;
  balance: Money;
}

/** The slice of the ATM a state may touch. */
export interface AtmContext {
  readonly bank: BankService;
  readonly dispenser: CashDispenser;
  readonly clock: Clock;
  card(): Card | undefined;
  accountId(): string | undefined;
  startSession(card: Card): void;
  authenticate(accountId: string): void;
  endSession(options?: { retainCard: boolean }): Card | undefined;
  nextRequestId(): string;
  transition(to: AtmState): void;
}

export interface AtmStateHandler {
  readonly name: AtmState;
  insertCard(card: Card): void;
  enterPin(pin: string): void;
  withdraw(amount: Money): WithdrawalReceipt;
  deposit(notes: Readonly<Record<number, number>>): Transaction;
  balance(): Money;
  miniStatement(last: number): Transaction[];
  ejectCard(): Card;
}

/** Default: nothing is allowed. Concrete states opt in to the operations they support. */
export abstract class BaseAtmState implements AtmStateHandler {
  abstract readonly name: AtmState;

  constructor(protected readonly atm: AtmContext) {}

  private reject(operation: string): never {
    throw new InvalidAtmOperationError(this.name, operation);
  }

  insertCard(_card: Card): void {
    this.reject('insert a card');
  }

  enterPin(_pin: string): void {
    this.reject('enter a PIN');
  }

  withdraw(_amount: Money): WithdrawalReceipt {
    return this.reject('withdraw');
  }

  deposit(_notes: Readonly<Record<number, number>>): Transaction {
    return this.reject('deposit');
  }

  balance(): Money {
    return this.reject('check the balance');
  }

  miniStatement(_last: number): Transaction[] {
    return this.reject('print a mini-statement');
  }

  ejectCard(): Card {
    return this.reject('eject a card');
  }
}
