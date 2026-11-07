import { InvalidDeliveryTransitionError } from './errors';
import type { Message } from './message';

export enum DeliveryState {
  READY = 'READY',
  IN_FLIGHT = 'IN_FLIGHT',
  AWAITING_RETRY = 'AWAITING_RETRY',
  ACKED = 'ACKED',
  DEAD_LETTERED = 'DEAD_LETTERED',
}

/** IN_FLIGHT -> IN_FLIGHT is a redelivery after the ack deadline passed: the consumer is presumed dead. */
const ALLOWED: Record<DeliveryState, readonly DeliveryState[]> = {
  [DeliveryState.READY]: [DeliveryState.IN_FLIGHT],
  [DeliveryState.IN_FLIGHT]: [
    DeliveryState.IN_FLIGHT,
    DeliveryState.ACKED,
    DeliveryState.AWAITING_RETRY,
    DeliveryState.DEAD_LETTERED,
  ],
  [DeliveryState.AWAITING_RETRY]: [DeliveryState.IN_FLIGHT, DeliveryState.DEAD_LETTERED],
  [DeliveryState.ACKED]: [],
  [DeliveryState.DEAD_LETTERED]: [],
};

/**
 * One consumer group's attempt history for one message. It is the unit of
 * at-least-once: until it reaches ACKED or DEAD_LETTERED the message will be
 * handed out again.
 */
export class Delivery {
  private currentState = DeliveryState.READY;
  private attemptCount = 0;
  private ackDeadlineMs = 0;
  private retryAtMs = 0;

  constructor(readonly message: Message) {}

  get state(): DeliveryState {
    return this.currentState;
  }

  get attempts(): number {
    return this.attemptCount;
  }

  /** Ready to be handed out again: its ack deadline or retry delay has passed. */
  isDue(nowMs: number): boolean {
    if (this.currentState === DeliveryState.IN_FLIGHT) return nowMs >= this.ackDeadlineMs;
    if (this.currentState === DeliveryState.AWAITING_RETRY) return nowMs >= this.retryAtMs;
    return false;
  }

  deliver(nowMs: number, ackTimeoutMs: number): void {
    if (this.currentState === DeliveryState.IN_FLIGHT && nowMs < this.ackDeadlineMs) {
      throw new InvalidDeliveryTransitionError(this.message.offset, 'IN_FLIGHT (before its deadline)', 'IN_FLIGHT');
    }
    this.transition(DeliveryState.IN_FLIGHT);
    this.attemptCount += 1;
    this.ackDeadlineMs = nowMs + ackTimeoutMs;
  }

  ack(): void {
    this.transition(DeliveryState.ACKED);
  }

  scheduleRetry(atMs: number): void {
    this.transition(DeliveryState.AWAITING_RETRY);
    this.retryAtMs = atMs;
  }

  deadLetter(): void {
    this.transition(DeliveryState.DEAD_LETTERED);
  }

  private transition(to: DeliveryState): void {
    if (!ALLOWED[this.currentState].includes(to)) {
      throw new InvalidDeliveryTransitionError(this.message.offset, this.currentState, to);
    }
    this.currentState = to;
  }
}
