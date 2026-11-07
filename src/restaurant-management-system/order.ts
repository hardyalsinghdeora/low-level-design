import type { Money } from '../shared/money';
import { EmptyOrderError, InvalidTransitionError } from './errors';
import type { Station } from './menu';

export enum OrderStatus {
  PLACED = 'PLACED',
  IN_KITCHEN = 'IN_KITCHEN',
  SERVED = 'SERVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.IN_KITCHEN, OrderStatus.CANCELLED],
  [OrderStatus.IN_KITCHEN]: [OrderStatus.SERVED],
  [OrderStatus.SERVED]: [OrderStatus.PAID],
  [OrderStatus.PAID]: [],
  [OrderStatus.CANCELLED]: [],
};

/** A snapshot of the menu item at order time, so a later price change never rewrites an open bill. */
export interface OrderLine {
  readonly id: string;
  readonly menuItemId: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly station: Station;
  readonly prepMinutes: number;
}

export function lineAmount(line: OrderLine): Money {
  return line.unitPrice * line.quantity;
}

/**
 * One table's order. Lines can be added only while PLACED; every status
 * change goes through the transition table, so a SERVED order cannot be
 * cancelled and a CANCELLED one cannot be paid.
 */
export class Order {
  private _status = OrderStatus.PLACED;
  private readonly _lines: OrderLine[] = [];

  constructor(
    readonly id: string,
    readonly tableId: string,
    readonly waiterId: string,
    readonly partySize: number,
    readonly openedAt: Date,
  ) {}

  get status(): OrderStatus {
    return this._status;
  }

  get lines(): readonly OrderLine[] {
    return [...this._lines];
  }

  get subtotal(): Money {
    return this._lines.reduce((sum, line) => sum + lineAmount(line), 0);
  }

  get isOpen(): boolean {
    return this._status !== OrderStatus.PAID && this._status !== OrderStatus.CANCELLED;
  }

  addLine(line: OrderLine): void {
    if (this._status !== OrderStatus.PLACED) throw new InvalidTransitionError('Order', this.id, this._status, 'add items');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new RangeError('quantity must be a positive integer');
    this._lines.push(line);
  }

  moveTo(next: OrderStatus): void {
    if (!ORDER_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidTransitionError('Order', this.id, this._status, `move to ${next}`);
    }
    if (next === OrderStatus.IN_KITCHEN && this._lines.length === 0) throw new EmptyOrderError(this.id);
    this._status = next;
  }
}
