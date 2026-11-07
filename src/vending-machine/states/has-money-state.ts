import type { Money } from '../../shared/money';
import { combineStock, sumCoins } from '../coin-inventory';
import { InsufficientChangeError, InsufficientFundsError, ProductOutOfStockError } from '../errors';
import { BaseState, MachineState } from './vending-state';

/**
 * Coins are in escrow. Selecting a product checks stock, funds and change
 * before anything moves, so a failed selection leaves the machine untouched.
 */
export class HasMoneyState extends BaseState {
  readonly name = MachineState.HAS_MONEY;

  override insertMoney(coin: Money): void {
    this.machine.coins.assertAccepted(coin);
    this.machine.addToEscrow(coin);
  }

  override selectProduct(slotCode: string): void {
    const slot = this.machine.inventory.get(slotCode);
    if (slot.isEmpty) throw new ProductOutOfStockError(slotCode);

    const paid = sumCoins(this.machine.escrow());
    if (paid < slot.product.price) throw new InsufficientFundsError(slot.product.price, paid);

    const due = paid - slot.product.price;
    // The inserted coins can be part of the change (pay 10+5+5, get a 5 back).
    const available = combineStock(this.machine.coins.stock(), this.machine.escrow());
    const change = this.machine.changeStrategy().makeChange(due, available);
    if (!change) {
      const refund = this.machine.releaseEscrow();
      this.machine.transition(MachineState.IDLE);
      throw new InsufficientChangeError(due, refund);
    }

    this.machine.setPendingSale({ slot, paid, change });
    this.machine.transition(MachineState.DISPENSING);
  }

  override cancel(): Money[] {
    const refund = this.machine.releaseEscrow();
    this.machine.transition(MachineState.IDLE);
    return refund;
  }
}
