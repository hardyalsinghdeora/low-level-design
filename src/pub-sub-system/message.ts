export type MessageHeaders = Readonly<Record<string, string>>;

/**
 * An immutable entry in a topic's log. The offset is the message's position
 * in that topic and is what consumers ack and commit; the id is global.
 */
export interface Message {
  readonly id: string;
  readonly topic: string;
  readonly offset: number;
  readonly key?: string;
  readonly payload: unknown;
  readonly headers: MessageHeaders;
  readonly publishedAt: Date;
}

export interface PublishOptions {
  key?: string;
  headers?: MessageHeaders;
}
