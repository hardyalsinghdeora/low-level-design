import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AddOnLimitExceededError,
  BrewedBeverage,
  CardPayment,
  CashPayment,
  CoffeeMachine,
  ESPRESSO,
  ExtraMilk,
  ExtraShot,
  Ingredient,
  IngredientCapacityExceededError,
  IngredientInventory,
  InsufficientCardBalanceError,
  InsufficientIngredientError,
  InsufficientPaymentError,
  LATTE,
  MaintenancePanel,
  PrepaidCard,
  Sugar,
  UnknownRecipeError,
} from './index';

function build(milk = 1_000) {
  const clock = new FakeClock('2026-03-01T08:00:00Z');
  const inventory = new IngredientInventory(
    {
      [Ingredient.COFFEE_BEANS]: { quantity: 500, capacity: 500, lowStockThreshold: 50 },
      [Ingredient.WATER]: { quantity: 2_000, capacity: 2_000, lowStockThreshold: 300 },
      [Ingredient.MILK]: { quantity: milk, capacity: 1_000, lowStockThreshold: 300 },
      [Ingredient.SUGAR]: { quantity: 100, capacity: 200, lowStockThreshold: 20 },
    },
    { clock },
  );
  const panel = new MaintenancePanel();
  inventory.subscribe(panel);
  const machine = new CoffeeMachine({ inventory, clock, ids: new SequentialIdGenerator() });
  return { machine, inventory, panel };
}

describe('Beverage decorators', () => {
  it('plain recipes carry their own price and ingredients', () => {
    const espresso = new BrewedBeverage(ESPRESSO);
    expect(espresso.price()).toBe(12_000);
    expect(espresso.ingredients()).toEqual({ COFFEE_BEANS: 18, WATER: 40 });
  });

  it('stacks price, ingredient deltas and description', () => {
    const drink = new Sugar(new ExtraMilk(new ExtraShot(new ExtraShot(new BrewedBeverage(LATTE)))));
    expect(drink.price()).toBe(20_000 + 2 * 4_000 + 3_000 + 500);
    expect(drink.ingredients()).toEqual({ COFFEE_BEANS: 54, WATER: 120, MILK: 300, SUGAR: 10 });
    expect(drink.description()).toBe('Latte + extra shot + extra shot + extra milk + sugar');
    expect(drink.addOns()).toHaveLength(4);
  });

  it('enforces the per-cup limit of each add-on', () => {
    const double = new ExtraShot(new ExtraShot(new BrewedBeverage(ESPRESSO)));
    expect(() => new ExtraShot(double)).toThrow(AddOnLimitExceededError);
    expect(() => new ExtraMilk(new ExtraMilk(new BrewedBeverage(LATTE)))).toThrow(AddOnLimitExceededError);
  });
});

describe('CoffeeMachine', () => {
  it('prepares a decorated drink, takes cash and consumes ingredients', () => {
    const { machine, inventory } = build();
    const order = machine.prepare(new Sugar(machine.brew('Cappuccino')), new CashPayment(20_000));
    expect(order).toMatchObject({ id: 'ORD-1', price: 18_500, description: 'Cappuccino + sugar' });
    expect(order.payment).toEqual({ method: 'cash', charged: 18_500, change: 1_500 });
    expect(inventory.level(Ingredient.MILK)).toBe(880);
    expect(inventory.level(Ingredient.SUGAR)).toBe(90);
    expect(machine.orders()).toHaveLength(1);
  });

  it('fails atomically when any ingredient is short: nothing consumed, nothing charged', () => {
    const { machine, inventory } = build(150);
    const card = new PrepaidCard('C1', 50_000);
    let error: unknown;
    try {
      machine.prepare(new ExtraShot(machine.brew('Latte')), new CardPayment(card));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InsufficientIngredientError);
    expect((error as InsufficientIngredientError).shortages).toEqual([
      { ingredient: Ingredient.MILK, needed: 200, available: 150 },
    ]);
    expect(inventory.level(Ingredient.COFFEE_BEANS)).toBe(500);
    expect(card.balance).toBe(50_000);
  });

  it('lists every shortage and leaves the inventory untouched on a direct consume', () => {
    const { inventory } = build(100);
    expect(() => inventory.consume({ MILK: 200, SUGAR: 500, WATER: 10 })).toThrow(InsufficientIngredientError);
    expect(inventory.shortages({ MILK: 200, SUGAR: 500, WATER: 10 }).map((s) => s.ingredient)).toEqual([
      Ingredient.MILK,
      Ingredient.SUGAR,
    ]);
    expect(inventory.level(Ingredient.WATER)).toBe(2_000);
  });

  it('rejects underpayment before consuming anything', () => {
    const { machine, inventory } = build();
    expect(() => machine.prepare(machine.brew('Latte'), new CashPayment(10_000))).toThrow(InsufficientPaymentError);
    const card = new PrepaidCard('C1', 5_000);
    expect(() => machine.prepare(machine.brew('Espresso'), new CardPayment(card))).toThrow(
      InsufficientCardBalanceError,
    );
    expect(inventory.level(Ingredient.MILK)).toBe(1_000);
    expect(machine.orders()).toHaveLength(0);
  });

  it('debits a prepaid card exactly with no change', () => {
    const { machine } = build();
    const card = new PrepaidCard('C1', 50_000);
    const order = machine.prepare(machine.brew('Espresso'), new CardPayment(card));
    expect(order.payment).toEqual({ method: 'card', charged: 12_000, change: 0 });
    expect(card.balance).toBe(38_000);
  });

  it('throws for an unknown recipe and marks unavailable drinks on the menu', () => {
    const { machine } = build(150);
    expect(() => machine.brew('Mocha')).toThrow(UnknownRecipeError);
    expect(machine.menu().map((m) => [m.name, m.available])).toEqual([
      ['Espresso', true],
      ['Cappuccino', true],
      ['Latte', false],
    ]);
  });
});

describe('IngredientInventory observers and refill', () => {
  it('fires a low-stock event once per threshold crossing and re-arms after a refill', () => {
    const { machine, inventory, panel } = build(600);
    const cash = () => new CashPayment(50_000);
    machine.prepare(machine.brew('Latte'), cash()); // 400
    expect(panel.alerts).toHaveLength(0);
    machine.prepare(machine.brew('Cappuccino'), cash()); // 280: crosses 300
    machine.prepare(machine.brew('Cappuccino'), cash()); // 160: still below, no new event
    expect(panel.alerts).toHaveLength(1);
    expect(panel.alerts[0]).toMatchObject({ ingredient: Ingredient.MILK, remaining: 280, threshold: 300 });

    inventory.refill(Ingredient.MILK, 500); // 660: re-armed
    machine.prepare(machine.brew('Latte'), cash()); // 460
    machine.prepare(machine.brew('Latte'), cash()); // 260: crosses again
    expect(panel.alerts).toHaveLength(2);
  });

  it('refill adds stock but never beyond the container capacity', () => {
    const { inventory } = build(500);
    inventory.refill(Ingredient.MILK, 500);
    expect(inventory.level(Ingredient.MILK)).toBe(1_000);
    expect(() => inventory.refill(Ingredient.MILK, 1)).toThrow(IngredientCapacityExceededError);
    expect(() => inventory.refill(Ingredient.SUGAR, 0)).toThrow(RangeError);
  });

  it('unsubscribed observers are no longer notified', () => {
    const { inventory } = build(400);
    const late = new MaintenancePanel();
    const unsubscribe = inventory.subscribe(late);
    unsubscribe();
    inventory.consume({ MILK: 200 });
    expect(late.alerts).toHaveLength(0);
  });
});
