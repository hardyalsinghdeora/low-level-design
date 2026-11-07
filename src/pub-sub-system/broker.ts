import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { type ConsumerGroupOptions, ConsumerGroup, type DeadLetterHandler } from './consumer-group';
import { SubscriptionExistsError, TopicAlreadyExistsError, TopicNotFoundError } from './errors';
import type { Message, PublishOptions } from './message';
import { type RetentionPolicy, Topic } from './topic';

export enum DeliveryOutcome {
  ACK = 'ACK',
  NACK = 'NACK',
}

/** A push subscriber. Returning nothing means success; throwing counts as a nack. */
export type PushHandler = (message: Message, attempt: number) => DeliveryOutcome | void;

export interface BrokerOptions {
  clock?: Clock;
  ids?: IdGenerator;
}

interface PushSubscription {
  readonly group: ConsumerGroup;
  readonly handler: PushHandler;
}

/**
 * The aggregate root: owns topics and consumer groups, and is the only place
 * that writes to a topic, including dead-letter topics. Publishers and
 * subscribers know the broker and a topic name, never each other, which is
 * the difference from an in-process Observer.
 */
export class Broker {
  private readonly topics = new Map<string, Topic>();
  private readonly groups = new Map<string, ConsumerGroup>();
  private readonly pushSubscriptions: PushSubscription[] = [];
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: BrokerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  createTopic(name: string, retention: RetentionPolicy = {}): Topic {
    if (this.topics.has(name)) throw new TopicAlreadyExistsError(name);
    const topic = new Topic(name, retention);
    this.topics.set(name, topic);
    return topic;
  }

  topic(name: string): Topic {
    const topic = this.topics.get(name);
    if (!topic) throw new TopicNotFoundError(name);
    return topic;
  }

  hasTopic(name: string): boolean {
    return this.topics.has(name);
  }

  publish(topicName: string, payload: unknown, options: PublishOptions = {}): Message {
    return this.topic(topicName).append(this.ids.next('msg'), payload, this.clock.now(), options);
  }

  /** Get or create a pull group. Consumers that share the id compete for its messages. */
  consumerGroup(topicName: string, groupId: string, options: ConsumerGroupOptions = {}): ConsumerGroup {
    const key = `${topicName}/${groupId}`;
    const existing = this.groups.get(key);
    if (existing) return existing;
    const group = new ConsumerGroup(groupId, this.topic(topicName), this.clock, this.deadLetterHandler, options);
    this.groups.set(key, group);
    return group;
  }

  /** A push subscription is a consumer group whose consumer is a callback the broker drives in dispatch(). */
  subscribe(topicName: string, groupId: string, handler: PushHandler, options: ConsumerGroupOptions = {}): ConsumerGroup {
    if (this.groups.has(`${topicName}/${groupId}`)) throw new SubscriptionExistsError(topicName, groupId);
    const group = this.consumerGroup(topicName, groupId, options);
    this.pushSubscriptions.push({ group, handler });
    return group;
  }

  /** Delivers everything currently due to push subscribers. Returns the number of handler calls. */
  dispatch(): number {
    let calls = 0;
    for (const { group, handler } of this.pushSubscriptions) {
      for (let batch = group.poll(); batch.length > 0; batch = group.poll()) {
        for (const { message, attempt } of batch) {
          calls += 1;
          let outcome: DeliveryOutcome | void;
          try {
            outcome = handler(message, attempt);
          } catch (error) {
            group.nack(message.offset, error instanceof Error ? error.message : String(error));
            continue;
          }
          if (outcome === DeliveryOutcome.NACK) group.nack(message.offset);
          else group.ack(message.offset);
        }
      }
    }
    return calls;
  }

  /** Applies age-based retention to every topic. Count-based retention runs on each publish. */
  applyRetention(): number {
    const now = this.clock.now();
    let removed = 0;
    for (const topic of this.topics.values()) removed += topic.applyRetention(now);
    return removed;
  }

  static deadLetterTopicName(topic: string, group: string): string {
    return `${topic}.${group}.dlq`;
  }

  /** Dead letters are per group: one subscriber's poison message must not hide it from the others. */
  private readonly deadLetterHandler: DeadLetterHandler = (group, delivery, reason) => {
    const original = delivery.message;
    const name = Broker.deadLetterTopicName(original.topic, group.id);
    if (!this.topics.has(name)) this.createTopic(name);
    this.publish(name, original.payload, {
      ...(original.key !== undefined ? { key: original.key } : {}),
      headers: {
        ...original.headers,
        'x-original-topic': original.topic,
        'x-original-offset': String(original.offset),
        'x-group': group.id,
        'x-attempts': String(delivery.attempts),
        'x-reason': reason,
      },
    });
  };
}
