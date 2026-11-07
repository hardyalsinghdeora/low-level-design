import type { Money } from '../shared/money';

/** One execution between a resting (maker) order and an incoming (taker) order, at the maker's price. */
export interface Trade {
  readonly id: string;
  readonly symbol: string;
  readonly price: Money;
  readonly quantity: number;
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly buyerFee: Money;
  readonly sellerFee: Money;
  readonly executedAt: Date;
}

/** Observer: market-data feeds, notifications and audit logs hear about every execution. */
export interface ExecutionListener {
  onExecution(trade: Trade): void;
}
