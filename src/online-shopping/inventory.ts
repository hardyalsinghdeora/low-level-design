import { InsufficientStockError, InvalidQuantityError, StockReservationError } from './errors';

export interface StockLevel {
  onHand: number;
  reserved: number;
}

export interface StockRequest {
  readonly productId: string;
  readonly quantity: number;
}

/**
 * Two-phase stock: reserve at order placement, commit at payment, release on
 * cancellation. `available = onHand - reserved` can never go below zero, which
 * is the "no overselling" invariant.
 */
export class Inventory {
  private readonly stock = new Map<string, StockLevel>();

  restock(productId: string, quantity: number): void {
    assertQuantity(quantity);
    this.level(productId).onHand += quantity;
  }

  available(productId: string): number {
    const level = this.stock.get(productId);
    return level ? level.onHand - level.reserved : 0;
  }

  levelOf(productId: string): Readonly<StockLevel> {
    return { ...this.level(productId) };
  }

  /** All or nothing: every line is checked before any is reserved. */
  reserve(requests: readonly StockRequest[]): void {
    const totals = sumByProduct(requests);
    for (const [productId, quantity] of totals) {
      const available = this.available(productId);
      if (quantity > available) throw new InsufficientStockError(productId, quantity, available);
    }
    for (const [productId, quantity] of totals) this.level(productId).reserved += quantity;
  }

  release(requests: readonly StockRequest[]): void {
    this.settle(requests, (level, quantity) => {
      level.reserved -= quantity;
    });
  }

  /** The goods are sold: they leave both the shelf and the reservation. */
  commit(requests: readonly StockRequest[]): void {
    this.settle(requests, (level, quantity) => {
      level.reserved -= quantity;
      level.onHand -= quantity;
    });
  }

  private settle(requests: readonly StockRequest[], apply: (level: StockLevel, quantity: number) => void): void {
    const totals = sumByProduct(requests);
    for (const [productId, quantity] of totals) {
      const reserved = this.level(productId).reserved;
      if (quantity > reserved) throw new StockReservationError(productId, quantity, reserved);
    }
    for (const [productId, quantity] of totals) apply(this.level(productId), quantity);
  }

  private level(productId: string): StockLevel {
    let level = this.stock.get(productId);
    if (!level) {
      level = { onHand: 0, reserved: 0 };
      this.stock.set(productId, level);
    }
    return level;
  }
}

export function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new InvalidQuantityError(quantity);
}

function sumByProduct(requests: readonly StockRequest[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { productId, quantity } of requests) {
    assertQuantity(quantity);
    totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  }
  return totals;
}
