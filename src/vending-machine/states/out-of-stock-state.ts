import { BaseState, MachineState } from './vending-state';

/** Every slot is empty. All customer actions are refused until an operator restocks. */
export class OutOfStockState extends BaseState {
  readonly name = MachineState.OUT_OF_STOCK;
}
