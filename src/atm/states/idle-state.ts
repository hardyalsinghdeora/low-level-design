import type { Card } from '../card';
import { CardExpiredError } from '../errors';
import { AtmState, BaseAtmState } from './atm-state';

/** No card in the slot. */
export class IdleState extends BaseAtmState {
  readonly name = AtmState.IDLE;

  override insertCard(card: Card): void {
    if (card.isExpired(this.atm.clock.now())) throw new CardExpiredError(card.number);
    this.atm.startSession(card);
    this.atm.transition(AtmState.CARD_INSERTED);
  }
}
