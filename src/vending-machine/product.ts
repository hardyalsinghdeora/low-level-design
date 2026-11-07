import { assertMoney, type Money } from '../shared/money';
import { ProductOutOfStockError, SlotCapacityExceededError } from './errors';

export interface Product {
  readonly sku: string;
  readonly name: string;
  readonly price: Money;
}

/**
 * One physical spiral in the machine. The slot, not the machine, guards its
 * own count, so stock can never go negative or exceed the spiral's capacity.
 */
export class Slot {
  private count = 0;

  constructor(
    readonly code: string,
    readonly product: Product,
    readonly capacity: number,
    initialQuantity = 0,
  ) {
    assertMoney(product.price, 'price');
    this.refill(initialQuantity);
  }

  get quantity(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  refill(units: number): void {
    if (!Number.isInteger(units) || units < 0) throw new RangeError(`Invalid refill quantity ${units}`);
    if (this.count + units > this.capacity) throw new SlotCapacityExceededError(this.code, this.capacity);
    this.count += units;
  }

  dispenseOne(): Product {
    if (this.count === 0) throw new ProductOutOfStockError(this.code);
    this.count -= 1;
    return this.product;
  }
}
