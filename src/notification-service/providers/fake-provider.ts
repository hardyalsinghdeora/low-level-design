import { type Channel, type NotificationProvider, type OutboundMessage, type ProviderReceipt } from '../channel';
import { ProviderError } from '../errors';

/** In-memory provider for tests and demos. It can be told to fail, which is how retries are exercised. */
export class FakeProvider implements NotificationProvider {
  readonly sent: OutboundMessage[] = [];
  private failuresLeft = 0;
  private failForever = false;
  private failureReason = 'provider unavailable';

  constructor(readonly channel: Channel) {}

  failNext(times: number, reason = 'provider unavailable'): this {
    this.failuresLeft = times;
    this.failureReason = reason;
    return this;
  }

  failAlways(reason = 'provider unavailable'): this {
    this.failForever = true;
    this.failureReason = reason;
    return this;
  }

  recover(): this {
    this.failForever = false;
    this.failuresLeft = 0;
    return this;
  }

  send(message: OutboundMessage): ProviderReceipt {
    if (this.failForever || this.failuresLeft > 0) {
      if (this.failuresLeft > 0) this.failuresLeft -= 1;
      throw new ProviderError(`${this.channel} ${this.failureReason}`);
    }
    this.sent.push(message);
    return { providerMessageId: `${this.channel.toLowerCase()}-${this.sent.length}` };
  }
}
