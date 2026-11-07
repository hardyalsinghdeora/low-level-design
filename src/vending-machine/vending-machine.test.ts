import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  assertTransition,
  GreedyChangeStrategy,
  InsufficientChangeError,
  InsufficientFundsError,
  InvalidActionError,
  InvalidDenominationError,
  InvalidStateTransitionError,
  Inventory,
  MachineState,
  MinimumCoinsChangeStrategy,
  ProductNotFoundError,
  ProductOutOfStockError,
  Slot,
  VendingMachine,
  type ChangeStrategy,
} from './index';

function build(options: { coinStock?: Record<number, number>; strategy?: ChangeStrategy; chips?: number; juice?: number } = {}) {
  const inventory = new Inventory()
    .addSlot(new Slot('A1', { sku: 'CHIPS', name: 'Chips', price: 1_500 }, 10, options.chips ?? 3))
    .addSlot(new Slot('A2', { sku: 'JUICE', name: 'Juice', price: 1_400 }, 10, options.juice ?? 0))
    .addSlot(new Slot('B1', { sku: 'CHOC', name: 'Chocolate', price: 4_000 }, 10, 0));
  const machine = new VendingMachine('Test', {
    inventory,
    coinStock: options.coinStock ?? { 500: 5, 200: 5, 100: 5 },
    changeStrategy: options.strategy,
    clock: new FakeClock('2026-03-01T09:00:00Z'),
    ids: new SequentialIdGenerator(),
  });
  return { machine, inventory };
}

describe('VendingMachine purchases', () => {
  it('sells a product and returns change, keeping the cash box consistent', () => {
    const { machine, inventory } = build();
    const before = machine.coins.total();
    machine.insertMoney(2_000);
    expect(machine.currentState).toBe(MachineState.HAS_MONEY);
    machine.selectProduct('A1');
    expect(machine.currentState).toBe(MachineState.DISPENSING);

    const result = machine.dispense();
    expect(result).toMatchObject({ saleId: 'SALE-1', change: [500], changeTotal: 500 });
    expect(result.product.name).toBe('Chips');
    expect(machine.currentState).toBe(MachineState.IDLE);
    expect(inventory.get('A1').quantity).toBe(2);
    expect(machine.coins.total()).toBe(before + 1_500);
    expect(machine.sales()[0]?.at.toISOString()).toBe('2026-03-01T09:00:00.000Z');
  });

  it('handles exact money with no change', () => {
    const { machine } = build({ coinStock: {} });
    machine.insertMoney(1_000);
    machine.insertMoney(500);
    machine.selectProduct('A1');
    expect(machine.dispense().change).toEqual([]);
  });

  it('can return one of the inserted coins as change', () => {
    const { machine } = build({ coinStock: {} });
    for (const c of [1_000, 500, 500]) machine.insertMoney(c);
    machine.selectProduct('A1');
    expect(machine.dispense().change).toEqual([500]);
    expect(machine.coins.total()).toBe(1_500);
  });

  it('rejects a selection with insufficient funds and keeps the money in escrow', () => {
    const { machine } = build();
    machine.insertMoney(1_000);
    expect(() => machine.selectProduct('A1')).toThrow(InsufficientFundsError);
    expect(machine.currentState).toBe(MachineState.HAS_MONEY);
    machine.insertMoney(500);
    machine.selectProduct('A1');
    expect(machine.dispense().changeTotal).toBe(0);
  });

  it('reports empty and unknown slots without leaving HAS_MONEY', () => {
    const { machine } = build();
    machine.insertMoney(5_000);
    expect(() => machine.selectProduct('B1')).toThrow(ProductOutOfStockError);
    expect(() => machine.selectProduct('Z9')).toThrow(ProductNotFoundError);
    expect(machine.insertedAmount).toBe(5_000);
  });

  it('cancel refunds exactly the inserted coins', () => {
    const { machine } = build();
    const before = machine.coins.total();
    machine.insertMoney(1_000);
    machine.insertMoney(200);
    expect(machine.cancel()).toEqual([1_000, 200]);
    expect(machine.currentState).toBe(MachineState.IDLE);
    expect(machine.coins.total()).toBe(before);
  });

  it('refunds and returns to IDLE when change cannot be made', () => {
    const { machine, inventory } = build({ coinStock: { 200: 2 } });
    machine.insertMoney(2_000);
    let error: unknown;
    try {
      machine.selectProduct('A1');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InsufficientChangeError);
    expect((error as InsufficientChangeError).refund).toEqual([2_000]);
    expect(machine.currentState).toBe(MachineState.IDLE);
    expect(inventory.get('A1').quantity).toBe(3);
    expect(machine.coins.total()).toBe(400);
  });

  it('rejects unaccepted denominations', () => {
    const { machine } = build();
    expect(() => machine.insertMoney(300)).toThrow(InvalidDenominationError);
    expect(machine.currentState).toBe(MachineState.IDLE);
  });
});

describe('VendingMachine states', () => {
  it('throws InvalidActionError for actions the current state does not allow', () => {
    const { machine } = build();
    expect(() => machine.selectProduct('A1')).toThrow(InvalidActionError);
    expect(() => machine.cancel()).toThrow(InvalidActionError);
    machine.insertMoney(2_000);
    expect(() => machine.dispense()).toThrow(InvalidActionError);
    machine.selectProduct('A1');
    expect(() => machine.insertMoney(100)).toThrow(InvalidActionError);
    expect(() => machine.cancel()).toThrow(InvalidActionError);
    expect(() => machine.restock('A1', 1)).toThrow(InvalidActionError);
  });

  it('goes OUT_OF_STOCK after the last item and back to IDLE on restock', () => {
    const { machine } = build({ chips: 1 });
    machine.insertMoney(1_000);
    machine.insertMoney(500);
    machine.selectProduct('A1');
    machine.dispense();
    expect(machine.currentState).toBe(MachineState.OUT_OF_STOCK);
    expect(() => machine.insertMoney(1_000)).toThrow(InvalidActionError);
    machine.restock('B1', 2);
    expect(machine.currentState).toBe(MachineState.IDLE);
  });

  it('validates the transition table', () => {
    expect(() => assertTransition(MachineState.IDLE, MachineState.DISPENSING)).toThrow(InvalidStateTransitionError);
    expect(() => assertTransition(MachineState.OUT_OF_STOCK, MachineState.HAS_MONEY)).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => assertTransition(MachineState.HAS_MONEY, MachineState.DISPENSING)).not.toThrow();
  });
});

describe('Change strategies', () => {
  const stock = new Map([
    [500, 1],
    [200, 3],
  ]);

  it('greedy gets stuck where minimum-coins finds a solution', () => {
    expect(new GreedyChangeStrategy().makeChange(600, stock)).toBeUndefined();
    expect(new MinimumCoinsChangeStrategy().makeChange(600, stock)).toEqual([200, 200, 200]);
    expect(new MinimumCoinsChangeStrategy().makeChange(900, stock)).toEqual([500, 200, 200]);
    expect(new MinimumCoinsChangeStrategy().makeChange(100, stock)).toBeUndefined();
  });

  it('the machine sells with minimum-coins where greedy would refund', () => {
    const coinStock = { 500: 1, 200: 3 };
    const greedy = build({ coinStock, juice: 1 }).machine;
    greedy.insertMoney(2_000);
    expect(() => greedy.selectProduct('A2')).toThrow(InsufficientChangeError);

    const dp = build({ coinStock, juice: 1, strategy: new MinimumCoinsChangeStrategy() }).machine;
    dp.insertMoney(2_000);
    dp.selectProduct('A2');
    expect(dp.dispense().change).toEqual([200, 200, 200]);
  });
});
