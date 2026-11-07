import type { Money } from '../shared/money';

export interface InvoiceLine {
  description: string;
  amount: Money;
}

/** Immutable bill issued once at check-out. Tax is computed on the subtotal and rounded half-up once. */
export class Invoice {
  readonly subtotal: Money;
  readonly tax: Money;
  readonly total: Money;

  constructor(
    readonly id: string,
    readonly reservationId: string,
    readonly guestName: string,
    readonly lines: readonly InvoiceLine[],
    readonly taxBps: number,
    readonly issuedAt: Date,
  ) {
    this.subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    this.tax = Math.round((this.subtotal * taxBps) / 10_000);
    this.total = this.subtotal + this.tax;
  }
}
