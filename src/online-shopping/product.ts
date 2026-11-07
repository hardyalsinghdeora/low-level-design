import { assertMoney, type Money } from '../shared/money';
import { ProductNotFoundError } from './errors';
import type { Specification } from './strategies/specification';

/** A sellable item. The price can change; carts and orders keep their own snapshot. */
export class Product {
  private _price: Money;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly category: string,
    price: Money,
    readonly tags: readonly string[] = [],
  ) {
    assertMoney(price, 'price');
    this._price = price;
  }

  get price(): Money {
    return this._price;
  }

  reprice(price: Money): void {
    assertMoney(price, 'price');
    this._price = price;
  }
}

/** The product list. Search takes a Specification, so new filters never change this class. */
export class Catalog {
  private readonly products = new Map<string, Product>();

  add(product: Product): this {
    if (this.products.has(product.id)) throw new RangeError(`Product ${product.id} already exists`);
    this.products.set(product.id, product);
    return this;
  }

  get(productId: string): Product {
    const product = this.products.get(productId);
    if (!product) throw new ProductNotFoundError(productId);
    return product;
  }

  search(spec: Specification<Product>): Product[] {
    return [...this.products.values()].filter((p) => spec.isSatisfiedBy(p)).sort((a, b) => a.price - b.price);
  }
}
