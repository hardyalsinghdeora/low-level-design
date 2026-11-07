import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import type { Transaction } from './account';
import type { Card } from './card';
import type { CashDispenser } from './cash-dispenser';
import type { BankService } from './services/bank-service';
import {
  assertAtmTransition,
  AtmState,
  type AtmContext,
  type AtmStateHandler,
  type WithdrawalReceipt,
} from './states/atm-state';
import { AuthenticatedState } from './states/authenticated-state';
import { CardInsertedState } from './states/card-inserted-state';
import { IdleState } from './states/idle-state';

export interface AtmOptions {
  bank: BankService;
  dispenser: CashDispenser;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Context of the State pattern. Holds the session (card, account) and the
 * hardware, and forwards every customer action to the current state.
 */
export class Atm {
  private readonly states: Record<AtmState, AtmStateHandler>;
  private state: AtmStateHandler;
  private session: { card: Card; accountId?: string } | undefined;
  private readonly retained: Card[] = [];

  constructor(
    readonly id: string,
    options: AtmOptions,
  ) {
    const clock = options.clock ?? new SystemClock();
    const ids = options.ids ?? new UuidGenerator();
    const context: AtmContext = {
      bank: options.bank,
      dispenser: options.dispenser,
      clock,
      card: () => this.session?.card,
      accountId: () => this.session?.accountId,
      startSession: (card) => {
        this.session = { card };
      },
      authenticate: (accountId) => {
        if (this.session) this.session.accountId = accountId;
      },
      endSession: (opts) => {
        const card = this.session?.card;
        if (card && opts?.retainCard) this.retained.push(card);
        this.session = undefined;
        return card;
      },
      nextRequestId: () => ids.next(`${this.id}-REQ`),
      transition: (to) => {
        assertAtmTransition(this.state.name, to);
        this.state = this.states[to];
      },
    };
    this.states = {
      [AtmState.IDLE]: new IdleState(context),
      [AtmState.CARD_INSERTED]: new CardInsertedState(context),
      [AtmState.AUTHENTICATED]: new AuthenticatedState(context),
    };
    this.state = this.states[AtmState.IDLE];
  }

  get currentState(): AtmState {
    return this.state.name;
  }

  /** Cards swallowed after too many wrong PINs. */
  get retainedCards(): readonly Card[] {
    return this.retained;
  }

  insertCard(card: Card): void {
    this.state.insertCard(card);
  }

  enterPin(pin: string): void {
    this.state.enterPin(pin);
  }

  withdraw(amount: Money): WithdrawalReceipt {
    return this.state.withdraw(amount);
  }

  deposit(notes: Readonly<Record<number, number>>): Transaction {
    return this.state.deposit(notes);
  }

  balance(): Money {
    return this.state.balance();
  }

  miniStatement(last = 5): Transaction[] {
    return this.state.miniStatement(last);
  }

  ejectCard(): Card {
    return this.state.ejectCard();
  }
}
