import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { CoinInventory, sumCoins } from './coin-inventory';
import { InvalidActionError } from './errors';
import type { Inventory } from './inventory';
import { DispensingState } from './states/dispensing-state';
import { HasMoneyState } from './states/has-money-state';
import { IdleState } from './states/idle-state';
import { OutOfStockState } from './states/out-of-stock-state';
import {
  assertTransition,
  MachineState,
  type DispenseResult,
  type PendingSale,
  type VendingContext,
  type VendingState,
} from './states/vending-state';
import { GreedyChangeStrategy, type ChangeStrategy } from './strategies/change';

/** Rs 1, 2, 5, 10, 20 and 50 in paise. */
export const DEFAULT_DENOMINATIONS: readonly Money[] = [100, 200, 500, 1_000, 2_000, 5_000];

export interface Sale {
  id: string;
  slotCode: string;
  productName: string;
  price: Money;
  paid: Money;
  change: Money[];
  at: Date;
}

export interface VendingMachineOptions {
  inventory: Inventory;
  acceptedDenominations?: readonly Money[];
  /** Initial cash box, e.g. { 500: 4, 100: 10 }. */
  coinStock?: Readonly<Record<number, number>>;
  changeStrategy?: ChangeStrategy;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Context of the State pattern. It owns escrow, the cash box and the pending
 * sale, and delegates every customer action to the current state object, so
 * there is no switch on state anywhere in the public API.
 */
export class VendingMachine {
  readonly inventory: Inventory;
  readonly coins: CoinInventory;
  private changeStrategy: ChangeStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly states: Record<MachineState, VendingState>;
  private state: VendingState;
  private escrowCoins: Money[] = [];
  private pendingSale: PendingSale | undefined;
  private readonly salesLog: Sale[] = [];

  constructor(
    readonly name: string,
    options: VendingMachineOptions,
  ) {
    this.inventory = options.inventory;
    this.coins = new CoinInventory(options.acceptedDenominations ?? DEFAULT_DENOMINATIONS, options.coinStock);
    this.changeStrategy = options.changeStrategy ?? new GreedyChangeStrategy();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();

    const context: VendingContext = {
      inventory: this.inventory,
      coins: this.coins,
      changeStrategy: () => this.changeStrategy,
      escrow: () => this.escrowCoins,
      addToEscrow: (coin) => {
        this.escrowCoins.push(coin);
      },
      releaseEscrow: () => {
        const refund = this.escrowCoins;
        this.escrowCoins = [];
        return refund;
      },
      setPendingSale: (sale) => {
        this.pendingSale = sale;
      },
      commitSale: () => this.commitSale(),
      transition: (to) => this.transition(to),
    };
    this.states = {
      [MachineState.IDLE]: new IdleState(context),
      [MachineState.HAS_MONEY]: new HasMoneyState(context),
      [MachineState.DISPENSING]: new DispensingState(context),
      [MachineState.OUT_OF_STOCK]: new OutOfStockState(context),
    };
    this.state = this.inventory.isEmpty ? this.states[MachineState.OUT_OF_STOCK] : this.states[MachineState.IDLE];
  }

  get currentState(): MachineState {
    return this.state.name;
  }

  get insertedAmount(): Money {
    return sumCoins(this.escrowCoins);
  }

  insertMoney(coin: Money): void {
    this.state.insertMoney(coin);
  }

  selectProduct(slotCode: string): void {
    this.state.selectProduct(slotCode);
  }

  dispense(): DispenseResult {
    return this.state.dispense();
  }

  cancel(): Money[] {
    return this.state.cancel();
  }

  /** Operator action. Only allowed with no customer mid-transaction. */
  restock(slotCode: string, units: number): void {
    if (this.state.name !== MachineState.IDLE && this.state.name !== MachineState.OUT_OF_STOCK) {
      throw new InvalidActionError(this.state.name, 'restock');
    }
    this.inventory.restock(slotCode, units);
    if (this.state.name === MachineState.OUT_OF_STOCK && !this.inventory.isEmpty) {
      this.transition(MachineState.IDLE);
    }
  }

  setChangeStrategy(strategy: ChangeStrategy): void {
    this.changeStrategy = strategy;
  }

  sales(): readonly Sale[] {
    return this.salesLog;
  }

  private transition(to: MachineState): void {
    assertTransition(this.state.name, to);
    this.state = this.states[to];
  }

  /** Moves product and cash together: escrow into the box first, then change out of it. */
  private commitSale(): DispenseResult {
    const sale = this.pendingSale;
    if (!sale) throw new InvalidActionError(this.state.name, 'dispense without a selection');
    const product = sale.slot.dispenseOne();
    this.coins.add(this.escrowCoins);
    this.coins.remove(sale.change);
    this.escrowCoins = [];
    this.pendingSale = undefined;

    const id = this.ids.next('SALE');
    this.salesLog.push({
      id,
      slotCode: sale.slot.code,
      productName: product.name,
      price: product.price,
      paid: sale.paid,
      change: sale.change,
      at: this.clock.now(),
    });
    return { saleId: id, product, change: sale.change, changeTotal: sumCoins(sale.change) };
  }
}
