import type { Money } from '../../shared/money';
import type { CoinInventory } from '../coin-inventory';
import { InvalidActionError, InvalidStateTransitionError } from '../errors';
import type { Inventory } from '../inventory';
import type { Product, Slot } from '../product';
import type { ChangeStrategy } from '../strategies/change';

export enum MachineState {
  IDLE = 'IDLE',
  HAS_MONEY = 'HAS_MONEY',
  DISPENSING = 'DISPENSING',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

const ALLOWED: Record<MachineState, readonly MachineState[]> = {
  [MachineState.IDLE]: [MachineState.HAS_MONEY, MachineState.OUT_OF_STOCK],
  [MachineState.HAS_MONEY]: [MachineState.IDLE, MachineState.DISPENSING],
  [MachineState.DISPENSING]: [MachineState.IDLE, MachineState.OUT_OF_STOCK],
  [MachineState.OUT_OF_STOCK]: [MachineState.IDLE],
};

export function assertTransition(from: MachineState, to: MachineState): void {
  if (!ALLOWED[from].includes(to)) throw new InvalidStateTransitionError(from, to);
}

/** A selection that has been paid for and whose change is already planned. */
export interface PendingSale {
  slot: Slot;
  paid: Money;
  change: Money[];
}

export interface DispenseResult {
  saleId: string;
  product: Product;
  change: Money[];
  changeTotal: Money;
}

/**
 * What a state may do to the machine. Narrower than the machine itself, so
 * states cannot bypass the transition table or reach the sales log.
 */
export interface VendingContext {
  readonly inventory: Inventory;
  readonly coins: CoinInventory;
  changeStrategy(): ChangeStrategy;
  escrow(): readonly Money[];
  addToEscrow(coin: Money): void;
  releaseEscrow(): Money[];
  setPendingSale(sale: PendingSale): void;
  commitSale(): DispenseResult;
  transition(to: MachineState): void;
}

export interface VendingState {
  readonly name: MachineState;
  insertMoney(coin: Money): void;
  selectProduct(slotCode: string): void;
  dispense(): DispenseResult;
  cancel(): Money[];
}

/** Every action is invalid by default; each concrete state overrides only what it allows. */
export abstract class BaseState implements VendingState {
  abstract readonly name: MachineState;

  constructor(protected readonly machine: VendingContext) {}

  insertMoney(_coin: Money): void {
    throw new InvalidActionError(this.name, 'insert money');
  }

  selectProduct(_slotCode: string): void {
    throw new InvalidActionError(this.name, 'select a product');
  }

  dispense(): DispenseResult {
    throw new InvalidActionError(this.name, 'dispense');
  }

  cancel(): Money[] {
    throw new InvalidActionError(this.name, 'cancel');
  }
}
