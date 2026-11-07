import type { Money } from '../shared/money';
import type { IngredientAmounts } from './ingredient';
import type { Recipe } from './recipe';

/** The component interface of the Decorator pattern: a drink and every wrapped variant of it. */
export interface Beverage {
  description(): string;
  price(): Money;
  ingredients(): IngredientAmounts;
  addOns(): string[];
}

/** The concrete component: a plain drink straight from its recipe. */
export class BrewedBeverage implements Beverage {
  constructor(readonly recipe: Recipe) {}

  description(): string {
    return this.recipe.name;
  }

  price(): Money {
    return this.recipe.price;
  }

  ingredients(): IngredientAmounts {
    return { ...this.recipe.ingredients };
  }

  addOns(): string[] {
    return [];
  }
}
