import { DomainError } from '../shared/errors';
import type { Money } from '../shared/money';
import type { Ingredient } from './ingredient';

export interface Shortage {
  ingredient: Ingredient;
  needed: number;
  available: number;
}

/** Thrown before anything is consumed, listing every ingredient that is short. */
export class InsufficientIngredientError extends DomainError {
  constructor(readonly shortages: readonly Shortage[]) {
    super(`Not enough ${shortages.map((s) => `${s.ingredient} (need ${s.needed}, have ${s.available})`).join(', ')}`);
  }
}

export class UnknownRecipeError extends DomainError {
  constructor(name: string) {
    super(`No recipe called ${name}`);
  }
}

export class AddOnLimitExceededError extends DomainError {
  constructor(addOn: string, max: number) {
    super(`At most ${max} x ${addOn} per cup`);
  }
}

export class InsufficientPaymentError extends DomainError {
  constructor(
    readonly price: Money,
    readonly tendered: Money,
  ) {
    super(`Price is ${price} but ${tendered} was tendered`);
  }
}

export class InsufficientCardBalanceError extends DomainError {
  constructor(cardId: string, balance: Money, amount: Money) {
    super(`Card ${cardId} has ${balance}, cannot pay ${amount}`);
  }
}

export class IngredientCapacityExceededError extends DomainError {
  constructor(ingredient: Ingredient, capacity: number) {
    super(`${ingredient} container holds at most ${capacity}`);
  }
}
