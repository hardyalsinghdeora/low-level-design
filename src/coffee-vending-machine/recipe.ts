import type { Money } from '../shared/money';
import { Ingredient, type IngredientAmounts } from './ingredient';

/** A base drink as data: what it costs and what it consumes. New drinks need no new class. */
export interface Recipe {
  readonly name: string;
  readonly price: Money;
  readonly ingredients: Readonly<IngredientAmounts>;
}

export const ESPRESSO: Recipe = {
  name: 'Espresso',
  price: 12_000,
  ingredients: { [Ingredient.COFFEE_BEANS]: 18, [Ingredient.WATER]: 40 },
};

export const CAPPUCCINO: Recipe = {
  name: 'Cappuccino',
  price: 18_000,
  ingredients: { [Ingredient.COFFEE_BEANS]: 18, [Ingredient.WATER]: 40, [Ingredient.MILK]: 120 },
};

export const LATTE: Recipe = {
  name: 'Latte',
  price: 20_000,
  ingredients: { [Ingredient.COFFEE_BEANS]: 18, [Ingredient.WATER]: 40, [Ingredient.MILK]: 200 },
};

export const DEFAULT_MENU: readonly Recipe[] = [ESPRESSO, CAPPUCCINO, LATTE];
