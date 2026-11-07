import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { BrewedBeverage, type Beverage } from './beverage';
import { UnknownRecipeError } from './errors';
import type { IngredientAmounts } from './ingredient';
import type { IngredientInventory } from './ingredient-inventory';
import type { PaymentMethod, PaymentReceipt } from './payment';
import { DEFAULT_MENU, type Recipe } from './recipe';

export interface MenuItem {
  name: string;
  price: Money;
  available: boolean;
}

export interface Order {
  id: string;
  description: string;
  price: Money;
  ingredients: IngredientAmounts;
  payment: PaymentReceipt;
  at: Date;
}

export interface CoffeeMachineOptions {
  inventory: IngredientInventory;
  menu?: readonly Recipe[];
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root. The order of prepare() is the design: check ingredients,
 * then take payment, then consume. A failure at either of the first two
 * steps leaves both the containers and the customer's money untouched.
 */
export class CoffeeMachine {
  readonly inventory: IngredientInventory;
  private readonly recipes = new Map<string, Recipe>();
  private readonly orderLog: Order[] = [];
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: CoffeeMachineOptions) {
    this.inventory = options.inventory;
    for (const r of options.menu ?? DEFAULT_MENU) this.recipes.set(r.name, r);
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  menu(): MenuItem[] {
    return [...this.recipes.values()].map((r) => ({
      name: r.name,
      price: r.price,
      available: this.inventory.canSupply(r.ingredients),
    }));
  }

  /** Starts a drink; wrap the result in add-on decorators before calling prepare(). */
  brew(name: string): Beverage {
    const recipe = this.recipes.get(name);
    if (!recipe) throw new UnknownRecipeError(name);
    return new BrewedBeverage(recipe);
  }

  prepare(beverage: Beverage, payment: PaymentMethod): Order {
    const needed = beverage.ingredients();
    this.inventory.assertAvailable(needed);
    const receipt = payment.collect(beverage.price());
    // Cannot fail now: availability was checked and nothing ran in between.
    this.inventory.consume(needed);

    const order: Order = {
      id: this.ids.next('ORD'),
      description: beverage.description(),
      price: beverage.price(),
      ingredients: needed,
      payment: receipt,
      at: this.clock.now(),
    };
    this.orderLog.push(order);
    return order;
  }

  orders(): readonly Order[] {
    return this.orderLog;
  }
}
