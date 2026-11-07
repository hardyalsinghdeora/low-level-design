import { BaseState, MachineState, type DispenseResult } from './vending-state';

/** Paid and change planned. Only dispense() is allowed; it cannot be cancelled half way. */
export class DispensingState extends BaseState {
  readonly name = MachineState.DISPENSING;

  override dispense(): DispenseResult {
    const result = this.machine.commitSale();
    this.machine.transition(this.machine.inventory.isEmpty ? MachineState.OUT_OF_STOCK : MachineState.IDLE);
    return result;
  }
}
