import type { Card } from '../card';
import { CardBlockedError } from '../errors';
import { AtmState, BaseAtmState } from './atm-state';

/** Card read, PIN not yet verified. A wrong PIN keeps us here; a blocked card is retained. */
export class CardInsertedState extends BaseAtmState {
  readonly name = AtmState.CARD_INSERTED;

  override enterPin(pin: string): void {
    const card = this.requireCard();
    try {
      const accountId = this.atm.bank.authenticate(card.number, pin);
      this.atm.authenticate(accountId);
      this.atm.transition(AtmState.AUTHENTICATED);
    } catch (error) {
      if (error instanceof CardBlockedError) {
        this.atm.endSession({ retainCard: true });
        this.atm.transition(AtmState.IDLE);
      }
      throw error;
    }
  }

  override ejectCard(): Card {
    const card = this.requireCard();
    this.atm.endSession();
    this.atm.transition(AtmState.IDLE);
    return card;
  }

  private requireCard(): Card {
    const card = this.atm.card();
    if (!card) throw new RangeError('Card inserted state without a card');
    return card;
  }
}
