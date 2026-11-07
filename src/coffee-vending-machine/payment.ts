import { assertMoney, type Money } from '../shared/money';
import { InsufficientCardBalanceError, InsufficientPaymentError } from './errors';

export interface PaymentReceipt {
  method: string;
  charged: Money;
  change: Money;
}

/** Strategy: how the price is collected. Throws a domain error if it cannot be. */
export interface PaymentMethod {
  readonly kind: string;
  collect(amount: Money): PaymentReceipt;
}

export class CashPayment implements PaymentMethod {
  readonly kind = 'cash';

  constructor(readonly tendered: Money) {
    assertMoney(tendered, 'tendered');
  }

  collect(amount: Money): PaymentReceipt {
    if (this.tendered < amount) throw new InsufficientPaymentError(amount, this.tendered);
    return { method: this.kind, charged: amount, change: this.tendered - amount };
  }
}

/** A stored-value card. It owns its balance, so it can never go negative. */
export class PrepaidCard {
  constructor(
    readonly id: string,
    private balanceMinor: Money,
  ) {
    assertMoney(balanceMinor, 'balance');
  }

  get balance(): Money {
    return this.balanceMinor;
  }

  debit(amount: Money): void {
    if (amount > this.balanceMinor) throw new InsufficientCardBalanceError(this.id, this.balanceMinor, amount);
    this.balanceMinor -= amount;
  }
}

export class CardPayment implements PaymentMethod {
  readonly kind = 'card';

  constructor(private readonly card: PrepaidCard) {}

  collect(amount: Money): PaymentReceipt {
    this.card.debit(amount);
    return { method: this.kind, charged: amount, change: 0 };
  }
}
