import type { Money } from '../shared/money';
import { InvalidOrderError, InvalidOrderTransitionError } from './errors';

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
}

export enum OrderStatus {
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.OPEN]: [OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED],
  [OrderStatus.PARTIALLY_FILLED]: [OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED, OrderStatus.CANCELLED],
  [OrderStatus.FILLED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REJECTED]: [],
};

/**
 * An instruction to trade, plus its execution state. It owns the lifecycle
 * (validated transitions), the filled quantity and the cash still reserved for
 * it, so the engine cannot overfill it or spend more than was set aside.
 */
export class Order {
  private _status = OrderStatus.OPEN;
  private _filled = 0;
  private _executedNotional: Money = 0;
  private _feesPaid: Money = 0;
  private _reservedCash: Money = 0;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly symbol: string,
    readonly side: OrderSide,
    readonly type: OrderType,
    readonly quantity: number,
    readonly limitPrice: Money | undefined,
    /** Arrival sequence: the "time" in price-time priority, independent of clock resolution. */
    readonly sequence: number,
    readonly placedAt: Date,
  ) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new InvalidOrderError(`Quantity must be a positive integer, got ${quantity}`);
    if (type === OrderType.LIMIT && (limitPrice === undefined || !Number.isInteger(limitPrice) || limitPrice <= 0)) {
      throw new InvalidOrderError(`A limit order needs a positive integer price, got ${limitPrice}`);
    }
    if (type === OrderType.MARKET && limitPrice !== undefined) throw new InvalidOrderError('A market order takes no limit price');
  }

  get status(): OrderStatus {
    return this._status;
  }

  get filledQuantity(): number {
    return this._filled;
  }

  get remaining(): number {
    return this.quantity - this._filled;
  }

  get executedNotional(): Money {
    return this._executedNotional;
  }

  get feesPaid(): Money {
    return this._feesPaid;
  }

  get reservedCash(): Money {
    return this._reservedCash;
  }

  get isActive(): boolean {
    return this._status === OrderStatus.OPEN || this._status === OrderStatus.PARTIALLY_FILLED;
  }

  /** True when this order is willing to trade at `price`. Market orders accept any price. */
  accepts(price: Money): boolean {
    if (this.limitPrice === undefined) return true;
    return this.side === OrderSide.BUY ? price <= this.limitPrice : price >= this.limitPrice;
  }

  holdCash(amount: Money): void {
    this._reservedCash += amount;
  }

  consumeCash(amount: Money): void {
    if (amount > this._reservedCash) throw new RangeError(`order ${this.id} reserved ${this._reservedCash}, cannot spend ${amount}`);
    this._reservedCash -= amount;
  }

  /** Hands back whatever is still reserved (price improvement, unfilled remainder). */
  releaseCash(amount: Money = this._reservedCash): Money {
    if (!Number.isInteger(amount) || amount < 0 || amount > this._reservedCash) {
      throw new RangeError(`order ${this.id} reserved ${this._reservedCash}, cannot release ${amount}`);
    }
    this._reservedCash -= amount;
    return amount;
  }

  fill(quantity: number, price: Money, fee: Money): void {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > this.remaining) {
      throw new RangeError(`cannot fill ${quantity} of order ${this.id} with ${this.remaining} remaining`);
    }
    const next = quantity === this.remaining ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED;
    this.transition(next);
    this._filled += quantity;
    this._executedNotional += quantity * price;
    this._feesPaid += fee;
  }

  cancel(): void {
    this.transition(OrderStatus.CANCELLED);
  }

  reject(): void {
    this.transition(OrderStatus.REJECTED);
  }

  private transition(to: OrderStatus): void {
    if (!TRANSITIONS[this._status].includes(to)) throw new InvalidOrderTransitionError(this.id, this._status, to);
    this._status = to;
  }
}
