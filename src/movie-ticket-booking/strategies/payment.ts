import { IdGenerator, UuidGenerator } from '../../shared/id-generator';
import type { Money } from '../../shared/money';

export interface PaymentRequest {
  amount: Money;
  userId: string;
  /** The booking id: retrying the same booking never charges twice. */
  idempotencyKey: string;
}

export type PaymentResult = { ok: true; paymentId: string } | { ok: false; reason: string };

/** Strategy: how money is taken. Card, UPI or wallet adapters implement the same interface. */
export interface PaymentStrategy {
  charge(request: PaymentRequest): PaymentResult;
  refund(paymentId: string, amount: Money): void;
}

export interface FakeGatewayOptions {
  /** Probability in [0, 1] that a charge is declined. */
  failureRate?: number;
  rng?: () => number;
  ids?: IdGenerator;
}

/** In-memory gateway that declines a configurable share of charges, driven by an injected rng. */
export class FakePaymentGateway implements PaymentStrategy {
  readonly refunds: { paymentId: string; amount: Money }[] = [];
  private readonly results = new Map<string, PaymentResult>();
  private readonly failureRate: number;
  private readonly rng: () => number;
  private readonly ids: IdGenerator;

  constructor(options: FakeGatewayOptions = {}) {
    this.failureRate = options.failureRate ?? 0;
    this.rng = options.rng ?? Math.random;
    this.ids = options.ids ?? new UuidGenerator();
  }

  get chargeCount(): number {
    return this.results.size;
  }

  charge(request: PaymentRequest): PaymentResult {
    const previous = this.results.get(request.idempotencyKey);
    if (previous) return previous;
    const result: PaymentResult =
      this.rng() < this.failureRate ? { ok: false, reason: 'card declined' } : { ok: true, paymentId: this.ids.next('PAY') };
    this.results.set(request.idempotencyKey, result);
    return result;
  }

  refund(paymentId: string, amount: Money): void {
    this.refunds.push({ paymentId, amount });
  }
}
