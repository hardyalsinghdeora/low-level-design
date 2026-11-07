import type { Broker } from './broker';
import type { Message, PublishOptions } from './message';

/**
 * A producer bound to one topic. It knows the broker, not the subscribers,
 * so adding a subscriber never changes publishing code.
 */
export class Publisher {
  constructor(
    private readonly broker: Broker,
    readonly topic: string,
  ) {
    broker.topic(topic); // fail fast on a typo instead of at the first publish
  }

  publish(payload: unknown, options: PublishOptions = {}): Message {
    return this.broker.publish(this.topic, payload, options);
  }

  publishAll(payloads: readonly unknown[]): Message[] {
    return payloads.map((payload) => this.publish(payload));
  }
}
