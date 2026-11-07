import type { NotificationProvider, OutboundMessage, ProviderReceipt } from '../channel';

export interface ProviderMetrics {
  calls: number;
  successes: number;
  failures: number;
}

/**
 * Decorator: adds metrics and logging to any provider without touching it or
 * the service. Stack several (metrics, circuit breaker, tracing) the same way.
 */
export class MeteredProvider implements NotificationProvider {
  readonly metrics: ProviderMetrics = { calls: 0, successes: 0, failures: 0 };

  constructor(
    private readonly inner: NotificationProvider,
    private readonly log: (line: string) => void = () => {},
  ) {}

  get channel() {
    return this.inner.channel;
  }

  send(message: OutboundMessage): ProviderReceipt {
    this.metrics.calls += 1;
    try {
      const receipt = this.inner.send(message);
      this.metrics.successes += 1;
      this.log(`${this.channel} -> ${message.to} ok (${receipt.providerMessageId})`);
      return receipt;
    } catch (error) {
      this.metrics.failures += 1;
      this.log(`${this.channel} -> ${message.to} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
