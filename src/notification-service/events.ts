import { Channel, Priority } from './channel';
import type { NotificationService } from './notification-service';

export interface OrderShipped {
  readonly type: 'OrderShipped';
  readonly orderId: string;
  readonly userId: string;
  readonly carrier: string;
  readonly trackingUrl: string;
}

export interface PasswordResetRequested {
  readonly type: 'PasswordResetRequested';
  readonly requestId: string;
  readonly userId: string;
  readonly code: string;
}

export type DomainEvent = OrderShipped | PasswordResetRequested;
export type EventOf<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

/**
 * Observer: the order and auth modules publish facts and know nothing about
 * notifications. Delivery is synchronous and in-process; a broker would sit
 * here in a distributed system (see problems/pub-sub-system.md).
 */
export class EventBus {
  private readonly handlers: Array<(event: DomainEvent) => void> = [];

  subscribe<T extends DomainEvent['type']>(type: T, handler: (event: EventOf<T>) => void): () => void {
    const listener = (event: DomainEvent): void => {
      if (event.type === type) handler(event as EventOf<T>);
    };
    this.handlers.push(listener);
    return () => {
      const index = this.handlers.indexOf(listener);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  publish(event: DomainEvent): void {
    for (const handler of [...this.handlers]) handler(event);
  }
}

/**
 * The mapping from business events to notifications, in one place. Each
 * idempotency key is derived from the event, so a redelivered event cannot
 * notify twice.
 */
export function registerNotificationRules(bus: EventBus, service: NotificationService): Array<() => void> {
  return [
    bus.subscribe('OrderShipped', (event) => {
      service.notify({
        userId: event.userId,
        templateId: 'order-shipped',
        channels: [Channel.EMAIL, Channel.PUSH],
        variables: { orderId: event.orderId, carrier: event.carrier, trackingUrl: event.trackingUrl },
        idempotencyKey: `order-shipped:${event.orderId}`,
      });
    }),
    bus.subscribe('PasswordResetRequested', (event) => {
      service.notify({
        userId: event.userId,
        templateId: 'password-reset',
        channels: [Channel.SMS],
        variables: { code: event.code },
        idempotencyKey: `password-reset:${event.requestId}`,
        priority: Priority.CRITICAL,
      });
    }),
  ];
}
