import { assertPositiveInteger } from './errors';
import type { Message, PublishOptions } from './message';

export interface RetentionPolicy {
  /** Keep at most this many messages; the oldest go first. */
  maxMessages?: number;
  /** Drop messages at least this old when retention is applied. */
  maxAgeMs?: number;
}

/**
 * An append-only, ordered log. Offsets only grow, so ordering within a topic
 * is the order of append(). Retention trims the front and moves firstOffset;
 * it never renumbers what is left.
 */
export class Topic {
  private log: Message[] = [];
  private baseOffset = 0;

  constructor(
    readonly name: string,
    readonly retention: RetentionPolicy = {},
  ) {
    if (retention.maxMessages !== undefined) assertPositiveInteger('retention.maxMessages', retention.maxMessages);
    if (retention.maxAgeMs !== undefined) assertPositiveInteger('retention.maxAgeMs', retention.maxAgeMs);
  }

  /** Oldest offset still retained. */
  get firstOffset(): number {
    return this.baseOffset;
  }

  /** The offset the next message will get. */
  get nextOffset(): number {
    return this.baseOffset + this.log.length;
  }

  get size(): number {
    return this.log.length;
  }

  append(id: string, payload: unknown, publishedAt: Date, options: PublishOptions = {}): Message {
    const message: Message = {
      id,
      topic: this.name,
      offset: this.nextOffset,
      ...(options.key !== undefined ? { key: options.key } : {}),
      payload,
      headers: { ...options.headers },
      publishedAt,
    };
    this.log.push(message);
    this.applyRetention(publishedAt);
    return message;
  }

  at(offset: number): Message | undefined {
    return offset < this.baseOffset ? undefined : this.log[offset - this.baseOffset];
  }

  messages(): readonly Message[] {
    return this.log;
  }

  /** Returns how many messages were dropped. */
  applyRetention(now: Date): number {
    const { maxMessages, maxAgeMs } = this.retention;
    let drop = 0;
    while (drop < this.log.length) {
      const remaining = this.log.length - drop;
      const oldest = this.log[drop]!;
      const tooMany = maxMessages !== undefined && remaining > maxMessages;
      const tooOld = maxAgeMs !== undefined && now.getTime() - oldest.publishedAt.getTime() >= maxAgeMs;
      if (!tooMany && !tooOld) break;
      drop += 1;
    }
    if (drop > 0) {
      this.log = this.log.slice(drop);
      this.baseOffset += drop;
    }
    return drop;
  }
}
