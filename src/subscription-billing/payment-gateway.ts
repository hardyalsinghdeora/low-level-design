import type { Money } from '../shared/money';

export interface ChargeRequest {
  readonly customerId: string;
  readonly amount: Money;
  /** Same key, same outcome: a retried network call never charges twice. */
  readonly idempotencyKey: string;
}

export interface ChargeResult {
  readonly success: boolean;
  readonly reference?: string;
  readonly failureReason?: string;
}

/** The card processor. Billing logic depends on this interface, never on a vendor SDK. */
export interface PaymentGateway {
  charge(request: ChargeRequest): ChargeResult;
}

/** In-memory gateway for tests and demos; it can be told to decline the next N charges or every charge. */
export class FakePaymentGateway implements PaymentGateway {
  private declinesLeft = 0;
  private declineAll = false;
  private readonly results = new Map<string, ChargeResult>();
  readonly attempts: ChargeRequest[] = [];

  declineNext(count = 1): void {
    this.declinesLeft += count;
  }

  setDeclineAll(decline: boolean): void {
    this.declineAll = decline;
  }

  get collected(): Money {
    return this.attempts.filter((a) => this.results.get(a.idempotencyKey)?.success).reduce((sum, a) => sum + a.amount, 0);
  }

  charge(request: ChargeRequest): ChargeResult {
    const previous = this.results.get(request.idempotencyKey);
    if (previous) return previous;
    this.attempts.push(request);
    let result: ChargeResult;
    if (this.declineAll || this.declinesLeft > 0) {
      this.declinesLeft = Math.max(0, this.declinesLeft - 1);
      result = { success: false, failureReason: 'card_declined' };
    } else {
      result = { success: true, reference: `ch-${this.attempts.length}` };
    }
    this.results.set(request.idempotencyKey, result);
    return result;
  }
}
