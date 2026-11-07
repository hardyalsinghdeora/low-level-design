import type { Money } from '../shared/money';
import { ProductNotFoundError } from './errors';
import type { Slot } from './product';

export interface SlotView {
  code: string;
  name: string;
  price: Money;
  quantity: number;
}

/** Product stock keyed by slot code (A1, A2, ...). */
export class Inventory {
  private readonly slots = new Map<string, Slot>();

  addSlot(slot: Slot): this {
    if (this.slots.has(slot.code)) throw new RangeError(`Slot ${slot.code} already exists`);
    this.slots.set(slot.code, slot);
    return this;
  }

  get(code: string): Slot {
    const slot = this.slots.get(code);
    if (!slot) throw new ProductNotFoundError(code);
    return slot;
  }

  restock(code: string, units: number): void {
    this.get(code).refill(units);
  }

  get isEmpty(): boolean {
    return [...this.slots.values()].every((slot) => slot.isEmpty);
  }

  snapshot(): SlotView[] {
    return [...this.slots.values()].map((s) => ({
      code: s.code,
      name: s.product.name,
      price: s.product.price,
      quantity: s.quantity,
    }));
  }
}
