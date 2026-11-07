import type { Money } from '../../shared/money';
import { BaseState, MachineState } from './vending-state';

/** Waiting for a customer. The first accepted coin moves the machine to HAS_MONEY. */
export class IdleState extends BaseState {
  readonly name = MachineState.IDLE;

  override insertMoney(coin: Money): void {
    this.machine.coins.assertAccepted(coin);
    this.machine.addToEscrow(coin);
    this.machine.transition(MachineState.HAS_MONEY);
  }
}
