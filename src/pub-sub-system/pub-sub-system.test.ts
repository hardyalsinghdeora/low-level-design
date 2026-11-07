import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Broker,
  DeliveryNotFoundError,
  DeliveryOutcome,
  DeliveryState,
  ExponentialBackoffRetryPolicy,
  FixedDelayRetryPolicy,
  InvalidConfigurationError,
  InvalidDeliveryTransitionError,
  type Message,
  Publisher,
  StartPosition,
  SubscriptionExistsError,
  TopicAlreadyExistsError,
  TopicNotFoundError,
} from './index';

function setup() {
  const clock = new FakeClock('2026-01-01T09:00:00Z');
  const broker = new Broker({ clock, ids: new SequentialIdGenerator() });
  broker.createTopic('orders');
  return { clock, broker };
}

const offsets = (items: Array<{ message: Message }>): number[] => items.map((r) => r.message.offset);

describe('Topics and publishing', () => {
  it('keeps an independent, gap-free order per topic', () => {
    const { broker } = setup();
    broker.createTopic('payments');
    broker.publish('orders', 'o0');
    broker.publish('payments', 'p0');
    broker.publish('orders', 'o1');
    const group = broker.consumerGroup('orders', 'g');
    expect(group.poll().map((r) => [r.message.offset, r.message.payload])).toEqual([
      [0, 'o0'],
      [1, 'o1'],
    ]);
    expect(broker.consumerGroup('payments', 'g').poll().map((r) => r.message.id)).toEqual(['msg-2']);
  });

  it('rejects unknown and duplicate topics and invalid configuration', () => {
    const { broker } = setup();
    expect(() => broker.publish('nope', 1)).toThrow(TopicNotFoundError);
    expect(() => new Publisher(broker, 'nope')).toThrow(TopicNotFoundError);
    expect(() => broker.createTopic('orders')).toThrow(TopicAlreadyExistsError);
    expect(() => broker.createTopic('bad', { maxMessages: 0 })).toThrow(InvalidConfigurationError);
    expect(() => broker.consumerGroup('orders', 'g', { ackTimeoutMs: -1 })).toThrow(InvalidConfigurationError);
  });

  it('drops the oldest messages under retention; a lagging group skips them and counts it', () => {
    const { broker, clock } = setup();
    broker.createTopic('events', { maxMessages: 2, maxAgeMs: 60_000 });
    const early = broker.consumerGroup('events', 'early');
    new Publisher(broker, 'events').publishAll(['a', 'b', 'c']);
    expect(broker.topic('events').firstOffset).toBe(1);
    expect(early.poll().map((r) => r.message.payload)).toEqual(['b', 'c']);
    expect(early.skipped).toBe(1);

    clock.advanceMinutes(1);
    expect(broker.applyRetention()).toBe(2);
    expect(broker.topic('events').size).toBe(0);
    expect(broker.topic('events').nextOffset).toBe(3); // offsets are never reused
  });
});

describe('Consumer groups (pull)', () => {
  it('gives every group every message and tracks commits independently', () => {
    const { broker } = setup();
    const billing = broker.consumerGroup('orders', 'billing');
    const analytics = broker.consumerGroup('orders', 'analytics');
    new Publisher(broker, 'orders').publishAll(['a', 'b', 'c']);

    for (const r of billing.poll()) billing.ack(r.message.offset);
    const seen = analytics.poll(1);
    expect(offsets(seen)).toEqual([0]);
    expect(billing.committedOffset).toBe(3);
    expect(analytics.committedOffset).toBe(0);
    expect(analytics.lag).toBe(3);
    expect(broker.consumerGroup('orders', 'billing')).toBe(billing); // a restarted consumer rejoins the same cursor
  });

  it('redelivers unacked messages after the ack timeout and commits only up to the first gap', () => {
    const { broker, clock } = setup();
    const group = broker.consumerGroup('orders', 'g', { ackTimeoutMs: 10_000 });
    new Publisher(broker, 'orders').publishAll(['a', 'b', 'c']);
    group.poll();
    group.ack(1); // out of order: 0 is still outstanding
    expect(group.committedOffset).toBe(0);

    clock.advanceSeconds(9);
    expect(group.poll()).toEqual([]);
    clock.advanceSeconds(1);
    const again = group.poll();
    expect(again.map((r) => [r.message.offset, r.attempt])).toEqual([
      [0, 2],
      [2, 2],
    ]);
    group.ack(0);
    expect(group.committedOffset).toBe(2);
  });

  it('retries a nacked message after the backoff, then dead-letters it after max attempts', () => {
    const { broker, clock } = setup();
    const group = broker.consumerGroup('orders', 'g', { retryPolicy: new FixedDelayRetryPolicy(3, 1_000) });
    broker.publish('orders', { orderId: 'ord-9' }, { key: 'ord-9' });
    broker.publish('orders', { orderId: 'ord-10' });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [first] = group.poll(1);
      expect(first?.attempt).toBe(attempt);
      group.nack(0, 'payment service down');
      if (attempt === 1) {
        expect(offsets(group.poll(1))).toEqual([1]); // 0 is not due yet, so the next message flows
        group.ack(1);
      }
      if (attempt < 3) {
        expect(group.stateOf(0)).toBe(DeliveryState.AWAITING_RETRY);
        clock.advanceSeconds(1);
      }
    }
    expect(group.stateOf(0)).toBeUndefined();
    expect(group.deadLettered).toBe(1);
    expect(group.committedOffset).toBe(2);
    const [dead] = broker.topic('orders.g.dlq').messages();
    expect(dead?.payload).toEqual({ orderId: 'ord-9' });
    expect(dead?.key).toBe('ord-9');
    expect(dead?.headers).toMatchObject({ 'x-original-offset': '0', 'x-attempts': '3', 'x-reason': 'payment service down' });
  });

  it('rejects acks for unknown offsets and for messages already waiting to be retried', () => {
    const { broker } = setup();
    const group = broker.consumerGroup('orders', 'g');
    broker.publish('orders', 'a');
    expect(() => group.ack(0)).toThrow(DeliveryNotFoundError); // not delivered yet
    group.poll();
    group.nack(0);
    expect(() => group.ack(0)).toThrow(InvalidDeliveryTransitionError);
  });

  it('processes strictly in order with maxInFlight 1 and can start from the latest offset', () => {
    const { broker } = setup();
    broker.publish('orders', 'old');
    const strict = broker.consumerGroup('orders', 'strict', { maxInFlight: 1, startFrom: StartPosition.LATEST });
    broker.publish('orders', 'new-1');
    broker.publish('orders', 'new-2');
    expect(strict.poll().map((r) => r.message.payload)).toEqual(['new-1']);
    expect(strict.poll()).toEqual([]);
    strict.ack(1);
    expect(strict.poll().map((r) => r.message.payload)).toEqual(['new-2']);
  });
});

describe('Push subscriptions', () => {
  it('delivers to each subscriber; a throwing handler retries then dead-letters without affecting the other', () => {
    const { broker } = setup();
    const audit: string[] = [];
    const sent: string[] = [];
    broker.subscribe('orders', 'audit', (m) => {
      audit.push(String(m.payload));
    });
    broker.subscribe(
      'orders',
      'email',
      (m, attempt) => {
        if (m.payload === 'bad') throw new Error(`smtp rejected on attempt ${attempt}`);
        sent.push(String(m.payload));
        return DeliveryOutcome.ACK;
      },
      { retryPolicy: new FixedDelayRetryPolicy(2, 1) },
    );
    new Publisher(broker, 'orders').publishAll(['a', 'bad', 'c']);

    broker.dispatch();
    expect(audit).toEqual(['a', 'bad', 'c']);
    expect(sent).toEqual(['a', 'c']);
    expect(broker.consumerGroup('orders', 'email').committedOffset).toBe(1); // 'bad' awaits its retry
    expect(() => broker.subscribe('orders', 'audit', () => {})).toThrow(SubscriptionExistsError);
  });

  it('treats an explicit NACK like a failure and stops after max attempts', () => {
    const { broker, clock } = setup();
    let calls = 0;
    broker.subscribe(
      'orders',
      'flaky',
      () => {
        calls += 1;
        return DeliveryOutcome.NACK;
      },
      { retryPolicy: new FixedDelayRetryPolicy(3, 500) },
    );
    broker.publish('orders', 'x');
    broker.dispatch();
    clock.advanceSeconds(1);
    broker.dispatch();
    clock.advanceSeconds(1);
    broker.dispatch();
    clock.advanceSeconds(1);
    expect(broker.dispatch()).toBe(0);
    expect(calls).toBe(3);
    expect(broker.topic(Broker.deadLetterTopicName('orders', 'flaky')).size).toBe(1);
  });
});

describe('Retry policies', () => {
  it('backs off exponentially up to a cap', () => {
    const policy = new ExponentialBackoffRetryPolicy(5, 1_000, 5_000);
    expect([1, 2, 3, 4].map((attempt) => policy.delayMs(attempt))).toEqual([1_000, 2_000, 4_000, 5_000]);
    expect(() => new ExponentialBackoffRetryPolicy(0)).toThrow(InvalidConfigurationError);
  });
});
