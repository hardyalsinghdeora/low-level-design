import type { Clock } from '../shared/clock';
import { Delivery, DeliveryState } from './delivery';
import { assertPositiveInteger, DeliveryNotFoundError } from './errors';
import type { Message } from './message';
import { FixedDelayRetryPolicy, type RetryPolicy } from './strategies/retry-policy';
import type { Topic } from './topic';

export enum StartPosition {
  EARLIEST = 'EARLIEST',
  LATEST = 'LATEST',
}

export interface ConsumerGroupOptions {
  /** How long a consumer may hold a message before it is presumed dead and the message is redelivered. */
  ackTimeoutMs?: number;
  retryPolicy?: RetryPolicy;
  /** Outstanding (unacked) messages allowed at once. 1 gives strict in-order processing. */
  maxInFlight?: number;
  startFrom?: StartPosition;
}

export interface ReceivedMessage {
  readonly message: Message;
  readonly attempt: number;
}

export type DeadLetterHandler = (group: ConsumerGroup, delivery: Delivery, reason: string) => void;

/**
 * A named cursor over one topic shared by competing consumers. Every group
 * sees every message; within a group each message is outstanding to one
 * consumer at a time. The committed offset is the low-water mark: everything
 * below it is acked or dead-lettered, so it is the one number to persist.
 */
export class ConsumerGroup {
  private cursor: number;
  /** Outstanding deliveries keyed by offset. Inserted in offset order, so iteration is ascending. */
  private readonly pending = new Map<number, Delivery>();
  private skippedCount = 0;
  private deadLetterCount = 0;
  readonly ackTimeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly maxInFlight: number;

  constructor(
    readonly id: string,
    readonly topic: Topic,
    private readonly clock: Clock,
    private readonly onDeadLetter: DeadLetterHandler,
    options: ConsumerGroupOptions = {},
  ) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? 30_000;
    this.retryPolicy = options.retryPolicy ?? new FixedDelayRetryPolicy();
    this.maxInFlight = options.maxInFlight ?? 100;
    assertPositiveInteger('ackTimeoutMs', this.ackTimeoutMs);
    assertPositiveInteger('maxInFlight', this.maxInFlight);
    this.cursor = options.startFrom === StartPosition.LATEST ? topic.nextOffset : topic.firstOffset;
  }

  get committedOffset(): number {
    const lowest = this.pending.keys().next();
    return lowest.done ? this.cursor : lowest.value;
  }

  get lag(): number {
    return this.topic.nextOffset - this.committedOffset;
  }

  get outstanding(): number {
    return this.pending.size;
  }

  /** Messages lost because retention removed them before this group read them. */
  get skipped(): number {
    return this.skippedCount;
  }

  get deadLettered(): number {
    return this.deadLetterCount;
  }

  /** Due redeliveries first, then new messages, returned in offset order. */
  poll(maxMessages = 10): ReceivedMessage[] {
    const now = this.clock.now().getTime();
    const out: ReceivedMessage[] = [];

    for (const delivery of [...this.pending.values()]) {
      if (out.length >= maxMessages) break;
      if (!delivery.isDue(now)) continue;
      if (delivery.attempts >= this.retryPolicy.maxAttempts) {
        this.deadLetter(delivery, 'ack timeout after max attempts');
        continue;
      }
      delivery.deliver(now, this.ackTimeoutMs);
      out.push({ message: delivery.message, attempt: delivery.attempts });
    }

    if (this.cursor < this.topic.firstOffset) {
      this.skippedCount += this.topic.firstOffset - this.cursor;
      this.cursor = this.topic.firstOffset;
    }
    while (out.length < maxMessages && this.pending.size < this.maxInFlight) {
      const message = this.topic.at(this.cursor);
      if (!message) break;
      this.cursor += 1;
      const delivery = new Delivery(message);
      this.pending.set(message.offset, delivery);
      delivery.deliver(now, this.ackTimeoutMs);
      out.push({ message, attempt: delivery.attempts });
    }
    return out.sort((a, b) => a.message.offset - b.message.offset);
  }

  ack(offset: number): void {
    const delivery = this.outstandingDelivery(offset);
    delivery.ack();
    this.pending.delete(offset);
  }

  /** Processing failed: retry after the policy's delay, or dead-letter once attempts are used up. */
  nack(offset: number, reason = 'nacked by consumer'): void {
    const delivery = this.outstandingDelivery(offset);
    delivery.scheduleRetry(this.clock.now().getTime() + this.retryPolicy.delayMs(delivery.attempts));
    if (delivery.attempts >= this.retryPolicy.maxAttempts) this.deadLetter(delivery, reason);
  }

  stateOf(offset: number): DeliveryState | undefined {
    return this.pending.get(offset)?.state;
  }

  private outstandingDelivery(offset: number): Delivery {
    const delivery = this.pending.get(offset);
    if (!delivery) throw new DeliveryNotFoundError(this.id, offset);
    return delivery;
  }

  private deadLetter(delivery: Delivery, reason: string): void {
    delivery.deadLetter();
    this.pending.delete(delivery.message.offset);
    this.deadLetterCount += 1;
    this.onDeadLetter(this, delivery, reason);
  }
}
