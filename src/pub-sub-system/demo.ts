import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { Broker, FixedDelayRetryPolicy, type Message, Publisher, TopicNotFoundError } from './index';

interface OrderPlaced {
  orderId: string;
  email: string;
}

const clock = new FakeClock('2026-03-01T09:00:00Z');
const broker = new Broker({ clock, ids: new SequentialIdGenerator() });
broker.createTopic('orders', { maxMessages: 1_000 });
const orders = new Publisher(broker, 'orders');
const show = (m: Message): string => `#${m.offset} ${(m.payload as OrderPlaced).orderId}`;

console.log('\n--- Two independent subscribers: email (push) and billing (pull) ---');
broker.subscribe(
  'orders',
  'email',
  (message, attempt) => {
    const order = message.payload as OrderPlaced;
    if (!order.email.includes('@')) {
      console.log(`  email   FAILED for ${show(message)} (attempt ${attempt})`);
      throw new Error(`invalid address "${order.email}"`);
    }
    console.log(`  email   sent for ${show(message)} (attempt ${attempt})`);
  },
  { retryPolicy: new FixedDelayRetryPolicy(3, 5_000) },
);
const billing = broker.consumerGroup('orders', 'billing', { ackTimeoutMs: 30_000 });

orders.publishAll([
  { orderId: 'ord-1', email: 'asha@example.com' },
  { orderId: 'ord-2', email: 'not-an-address' },
  { orderId: 'ord-3', email: 'ravi@example.com' },
]);

broker.dispatch();

console.log('\n--- Billing takes two messages, acks one, then its process crashes ---');
const batch = billing.poll(2);
console.log(`  billing got ${batch.map((r) => show(r.message)).join(', ')}`);
billing.ack(batch[0]!.message.offset);
console.log(`  committed offset ${billing.committedOffset}, lag ${billing.lag}`);

console.log('\n--- 30 s later the unacked message is redelivered (at-least-once) ---');
clock.advanceSeconds(30);
for (const { message, attempt } of billing.poll()) {
  console.log(`  billing got ${show(message)} attempt ${attempt}`);
  billing.ack(message.offset);
}
console.log(`  committed offset ${billing.committedOffset}, lag ${billing.lag}`);

console.log('\n--- The email for ord-2 keeps failing: retried, then dead-lettered ---');
for (let i = 0; i < 2; i += 1) {
  clock.advanceSeconds(5);
  broker.dispatch();
}
const dlq = broker.topic(Broker.deadLetterTopicName('orders', 'email'));
for (const m of dlq.messages()) {
  console.log(`  DLQ holds ${(m.payload as OrderPlaced).orderId} (orders #${m.headers['x-original-offset']}) after ${m.headers['x-attempts']} attempts: ${m.headers['x-reason']}`);
}
console.log(`  email committed offset ${broker.consumerGroup('orders', 'email').committedOffset}`);

console.log('\n--- Publishing to a topic that was never created fails fast ---');
try {
  new Publisher(broker, 'order');
} catch (error) {
  if (!(error instanceof TopicNotFoundError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
}
