export enum Ingredient {
  COFFEE_BEANS = 'COFFEE_BEANS',
  WATER = 'WATER',
  MILK = 'MILK',
  SUGAR = 'SUGAR',
}

/** Grams or millilitres; always integers so sums never drift. */
export const UNIT: Record<Ingredient, string> = {
  [Ingredient.COFFEE_BEANS]: 'g',
  [Ingredient.WATER]: 'ml',
  [Ingredient.MILK]: 'ml',
  [Ingredient.SUGAR]: 'g',
};

export type IngredientAmounts = Partial<Record<Ingredient, number>>;

export function addAmounts(a: Readonly<IngredientAmounts>, b: Readonly<IngredientAmounts>): IngredientAmounts {
  const sum: IngredientAmounts = { ...a };
  for (const [ingredient, amount] of amountEntries(b)) sum[ingredient] = (sum[ingredient] ?? 0) + amount;
  return sum;
}

export function amountEntries(amounts: Readonly<IngredientAmounts>): [Ingredient, number][] {
  return (Object.values(Ingredient) as Ingredient[])
    .filter((i) => (amounts[i] ?? 0) > 0)
    .map((i) => [i, amounts[i] ?? 0]);
}
