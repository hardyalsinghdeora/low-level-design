import type { FoodOrderStatus } from './food-order';

export interface OrderStatusEvent {
  readonly orderId: string;
  readonly customerId: string;
  readonly restaurantId: string;
  readonly partnerId: string | null;
  readonly status: FoodOrderStatus;
  readonly at: Date;
}

/** Observer: the customer app, restaurant tablet and rider app all follow the same stream. */
export interface OrderObserver {
  onStatusChange(event: OrderStatusEvent): void;
}

/** Records every event so tests and the demo can inspect the timeline. */
export class RecordingObserver implements OrderObserver {
  readonly events: OrderStatusEvent[] = [];

  onStatusChange(event: OrderStatusEvent): void {
    this.events.push(event);
  }

  timeline(orderId: string): FoodOrderStatus[] {
    return this.events.filter((e) => e.orderId === orderId).map((e) => e.status);
  }
}
