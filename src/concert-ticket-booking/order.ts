import type { Money } from '../shared/money';
import type { ConcertEvent } from './concert-event';
import { InvalidOrderTransitionError } from './errors';
import type { Allocation } from './ticket-category';

export enum OrderStatus {
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

export interface OrderLine extends Allocation {
  unitPrice: Money;
}

/** Several tickets bought together; they were allocated together and are refunded together. */
export class Order {
  private current = OrderStatus.CONFIRMED;
  private refunded: Money = 0;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly event: ConcertEvent,
    readonly lines: readonly OrderLine[],
    readonly createdAt: Date,
  ) {}

  get status(): OrderStatus {
    return this.current;
  }

  get total(): Money {
    return this.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  }

  get ticketCount(): number {
    return this.lines.reduce((sum, line) => sum + line.quantity, 0);
  }

  get refundedAmount(): Money {
    return this.refunded;
  }

  cancel(refund: Money): void {
    if (this.current !== OrderStatus.CONFIRMED) {
      throw new InvalidOrderTransitionError(this.id, this.current, OrderStatus.CANCELLED);
    }
    this.current = OrderStatus.CANCELLED;
    this.refunded = refund;
  }
}
