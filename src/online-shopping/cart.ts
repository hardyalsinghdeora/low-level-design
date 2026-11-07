import type { Money } from '../shared/money';
import { assertQuantity } from './inventory';
import type { Product } from './product';

export interface CartLine {
  readonly productId: string;
  readonly name: string;
  /** Price when the item was first added. A later reprice does not surprise the customer. */
  readonly unitPrice: Money;
  readonly quantity: number;
}

/** One customer's cart. Adding a product twice merges the lines instead of duplicating them. */
export class Cart {
  private readonly items = new Map<string, CartLine>();

  constructor(readonly customerId: string) {}

  add(product: Product, quantity = 1): CartLine {
    assertQuantity(quantity);
    const existing = this.items.get(product.id);
    const line: CartLine = existing
      ? { ...existing, quantity: existing.quantity + quantity }
      : { productId: product.id, name: product.name, unitPrice: product.price, quantity };
    this.items.set(product.id, line);
    return line;
  }

  setQuantity(productId: string, quantity: number): void {
    assertQuantity(quantity);
    const line = this.items.get(productId);
    if (line) this.items.set(productId, { ...line, quantity });
  }

  remove(productId: string): void {
    this.items.delete(productId);
  }

  clear(): void {
    this.items.clear();
  }

  get lines(): readonly CartLine[] {
    return [...this.items.values()];
  }

  get isEmpty(): boolean {
    return this.items.size === 0;
  }

  get subtotal(): Money {
    return this.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  }
}
