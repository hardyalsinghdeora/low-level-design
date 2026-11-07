export interface Message {
  id: string;
  fromId: string;
  toId: string;
  body: string;
  sentAt: Date;
}

/**
 * The thread between two members. The key is order independent, so A->B and
 * B->A land in the same conversation. Whether the two may talk at all is the
 * service's decision (1st-degree only); the conversation just keeps order.
 */
export class Conversation {
  private readonly _messages: Message[] = [];

  constructor(readonly memberIds: readonly [string, string]) {}

  static keyFor(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  get messages(): readonly Message[] {
    return this._messages;
  }

  append(message: Message): void {
    const members = new Set(this.memberIds);
    if (!members.has(message.fromId) || !members.has(message.toId)) {
      throw new RangeError(`message ${message.id} does not belong to this conversation`);
    }
    this._messages.push(message);
  }
}
