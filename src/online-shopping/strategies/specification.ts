import type { Money } from '../../shared/money';
import type { Inventory } from '../inventory';
import type { Product } from '../product';

/** Specification pattern: a filter is an object, and filters compose with and / or / not. */
export interface Specification<T> {
  isSatisfiedBy(item: T): boolean;
}

/** Base class that gives every specification the fluent combinators. */
export abstract class Spec<T> implements Specification<T> {
  abstract isSatisfiedBy(item: T): boolean;

  and(other: Specification<T>): Spec<T> {
    return new PredicateSpec((item: T) => this.isSatisfiedBy(item) && other.isSatisfiedBy(item));
  }

  or(other: Specification<T>): Spec<T> {
    return new PredicateSpec((item: T) => this.isSatisfiedBy(item) || other.isSatisfiedBy(item));
  }

  not(): Spec<T> {
    return new PredicateSpec((item: T) => !this.isSatisfiedBy(item));
  }
}

class PredicateSpec<T> extends Spec<T> {
  constructor(private readonly predicate: (item: T) => boolean) {
    super();
  }

  isSatisfiedBy(item: T): boolean {
    return this.predicate(item);
  }
}

export class InCategory extends Spec<Product> {
  constructor(private readonly category: string) {
    super();
  }

  isSatisfiedBy(product: Product): boolean {
    return product.category === this.category;
  }
}

/** Inclusive range in minor units. */
export class PriceBetween extends Spec<Product> {
  constructor(
    private readonly min: Money,
    private readonly max: Money,
  ) {
    super();
  }

  isSatisfiedBy(product: Product): boolean {
    return product.price >= this.min && product.price <= this.max;
  }
}

export class NameContains extends Spec<Product> {
  constructor(private readonly text: string) {
    super();
  }

  isSatisfiedBy(product: Product): boolean {
    return product.name.toLowerCase().includes(this.text.toLowerCase());
  }
}

export class HasTag extends Spec<Product> {
  constructor(private readonly tag: string) {
    super();
  }

  isSatisfiedBy(product: Product): boolean {
    return product.tags.includes(this.tag);
  }
}

/** Reads live availability, so "in stock" hides items that are fully reserved. */
export class InStock extends Spec<Product> {
  constructor(private readonly inventory: Inventory) {
    super();
  }

  isSatisfiedBy(product: Product): boolean {
    return this.inventory.available(product.id) > 0;
  }
}
