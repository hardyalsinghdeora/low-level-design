import type { Money } from '../shared/money';
import { InvalidOrderError } from './errors';
import { OrderSide, OrderType, type Order } from './order';

export interface PriceLevel {
  readonly price: Money;
  readonly quantity: number;
  readonly orders: number;
}

const bidPriority = (a: Order, b: Order): number => (b.limitPrice ?? 0) - (a.limitPrice ?? 0) || a.sequence - b.sequence;
const askPriority = (a: Order, b: Order): number => (a.limitPrice ?? 0) - (b.limitPrice ?? 0) || a.sequence - b.sequence;

/**
 * Resting limit orders for one symbol, kept in price-time priority: bids highest
 * price first, asks lowest first, earlier arrival first at the same price. It only
 * answers "who is next"; moving cash and shares is the brokerage's job.
 */
export class OrderBook {
  private readonly bids: Order[] = [];
  private readonly asks: Order[] = [];

  constructor(readonly symbol: string) {}

  add(order: Order): void {
    if (order.type !== OrderType.LIMIT || !order.isActive || order.symbol !== this.symbol) {
      throw new InvalidOrderError(`Only active ${this.symbol} limit orders can rest on the book`);
    }
    const [side, priority] = order.side === OrderSide.BUY ? [this.bids, bidPriority] : [this.asks, askPriority];
    const index = side.findIndex((resting) => priority(order, resting) < 0);
    side.splice(index === -1 ? side.length : index, 0, order);
  }

  remove(orderId: string): boolean {
    for (const side of [this.bids, this.asks]) {
      const index = side.findIndex((order) => order.id === orderId);
      if (index !== -1) {
        side.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  /** The best resting order an incoming order of `side` would trade against. */
  bestOpposite(side: OrderSide): Order | undefined {
    return side === OrderSide.BUY ? this.asks[0] : this.bids[0];
  }

  depth(side: OrderSide): PriceLevel[] {
    const levels = new Map<Money, PriceLevel>();
    for (const order of side === OrderSide.BUY ? this.bids : this.asks) {
      const price = order.limitPrice ?? 0;
      const level = levels.get(price) ?? { price, quantity: 0, orders: 0 };
      levels.set(price, { price, quantity: level.quantity + order.remaining, orders: level.orders + 1 });
    }
    return [...levels.values()];
  }
}
