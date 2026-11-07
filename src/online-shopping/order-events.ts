import { formatMoney, type Money } from '../shared/money';
import type { OrderStatus } from './order';

export interface OrderEvent {
  readonly orderId: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly at: Date;
  readonly total: Money;
  /** Non-zero when a cancellation or return owes the customer money. */
  readonly refundDue: Money;
}

/** Observer: email, SMS or a warehouse feed subscribe to status changes without the shop knowing them. */
export interface OrderObserver {
  onOrderEvent(event: OrderEvent): void;
}

/** Keeps messages per customer so tests and the demo can read them. */
export class InMemoryOrderNotifier implements OrderObserver {
  private readonly sent: { customerId: string; message: string }[] = [];

  onOrderEvent(event: OrderEvent): void {
    const refund = event.refundDue > 0 ? `, refund ${formatMoney(event.refundDue)}` : '';
    this.sent.push({ customerId: event.customerId, message: `${event.orderId} ${event.status}${refund}` });
  }

  inbox(customerId: string): string[] {
    return this.sent.filter((n) => n.customerId === customerId).map((n) => n.message);
  }
}
