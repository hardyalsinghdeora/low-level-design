import type { Money } from '../shared/money';
import type { Beverage } from './beverage';
import { AddOnLimitExceededError } from './errors';
import { addAmounts, Ingredient, type IngredientAmounts } from './ingredient';

interface AddOnSpec {
  label: string;
  price: Money;
  ingredients: IngredientAmounts;
  maxPerCup: number;
}

/**
 * Decorator: wraps a beverage and adds a price delta and an ingredient delta.
 * Decorators stack in any order, and each one enforces its own per-cup limit.
 */
export abstract class AddOnDecorator implements Beverage {
  protected constructor(
    protected readonly inner: Beverage,
    private readonly spec: AddOnSpec,
  ) {
    const already = inner.addOns().filter((a) => a === spec.label).length;
    if (already >= spec.maxPerCup) throw new AddOnLimitExceededError(spec.label, spec.maxPerCup);
  }

  description(): string {
    return `${this.inner.description()} + ${this.spec.label}`;
  }

  price(): Money {
    return this.inner.price() + this.spec.price;
  }

  ingredients(): IngredientAmounts {
    return addAmounts(this.inner.ingredients(), this.spec.ingredients);
  }

  addOns(): string[] {
    return [...this.inner.addOns(), this.spec.label];
  }
}

export class ExtraShot extends AddOnDecorator {
  constructor(inner: Beverage) {
    super(inner, {
      label: 'extra shot',
      price: 4_000,
      ingredients: { [Ingredient.COFFEE_BEANS]: 18, [Ingredient.WATER]: 40 },
      maxPerCup: 2,
    });
  }
}

export class ExtraMilk extends AddOnDecorator {
  constructor(inner: Beverage) {
    super(inner, { label: 'extra milk', price: 3_000, ingredients: { [Ingredient.MILK]: 100 }, maxPerCup: 1 });
  }
}

export class Sugar extends AddOnDecorator {
  constructor(inner: Beverage) {
    super(inner, { label: 'sugar', price: 500, ingredients: { [Ingredient.SUGAR]: 10 }, maxPerCup: 3 });
  }
}
