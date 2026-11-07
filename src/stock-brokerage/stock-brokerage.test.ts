import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AccountNotFoundError,
  Brokerage,
  DuplicateAccountError,
  FlatFeeStrategy,
  InsufficientFundsError,
  InsufficientHoldingsError,
  InvalidOrderError,
  InvalidOrderTransitionError,
  Order,
  OrderNotFoundError,
  OrderSide,
  OrderStatus,
  OrderType,
  PercentageFeeStrategy,
  UnknownSymbolError,
  type FeeStrategy,
  type OrderRequest,
  type Trade,
} from './index';

const CASH = 5_000_000; // Rs 50,000 each
const USERS = ['alice', 'bob', 'carol', 'dave'];

function build(feeStrategy?: FeeStrategy) {
  const brokerage = new Brokerage({ clock: new FakeClock('2026-03-02T09:15:00Z'), ids: new SequentialIdGenerator(), feeStrategy });
  brokerage.listSymbol('ACME');
  for (const id of USERS) {
    const account = brokerage.openAccount(id);
    account.deposit(CASH);
    account.depositShares('ACME', 100);
  }
  const trades: Trade[] = [];
  brokerage.subscribe({ onExecution: (trade) => trades.push(trade) });
  return { brokerage, trades };
}

const limit = (userId: string, side: OrderSide, quantity: number, limitPrice: number): OrderRequest => ({
  userId, symbol: 'ACME', side, type: OrderType.LIMIT, quantity, limitPrice,
});
const market = (userId: string, side: OrderSide, quantity: number): OrderRequest => ({ userId, symbol: 'ACME', side, type: OrderType.MARKET, quantity });
const { BUY, SELL } = OrderSide;
const totalCash = (b: Brokerage) => USERS.reduce((sum, id) => sum + b.account(id).availableCash + b.account(id).reservedCash, 0);

describe('order book', () => {
  it('rests non-crossing limit orders in price order on each side', () => {
    const { brokerage, trades } = build();
    brokerage.placeOrder(limit('bob', SELL, 5, 10_100));
    brokerage.placeOrder(limit('carol', SELL, 5, 10_000));
    brokerage.placeOrder(limit('alice', BUY, 3, 9_900));
    const dave = brokerage.placeOrder(limit('dave', BUY, 2, 9_950));
    expect(trades).toHaveLength(0);
    expect(dave.status).toBe(OrderStatus.OPEN);
    expect(brokerage.book('ACME').depth(SELL).map((l) => l.price)).toEqual([10_000, 10_100]);
    expect(brokerage.book('ACME').depth(BUY).map((l) => l.price)).toEqual([9_950, 9_900]);
  });

  it('matches by price first, then by arrival time', () => {
    const { brokerage, trades } = build();
    const bob = brokerage.placeOrder(limit('bob', SELL, 5, 10_000));
    const carol = brokerage.placeOrder(limit('carol', SELL, 5, 10_000));
    brokerage.placeOrder(limit('dave', SELL, 5, 9_990)); // later, but a better price
    brokerage.placeOrder(limit('alice', BUY, 8, 10_000));
    expect(trades.map((t) => [t.sellerId, t.quantity, t.price])).toEqual([['dave', 5, 9_990], ['bob', 3, 10_000]]);
    expect(bob.status).toBe(OrderStatus.PARTIALLY_FILLED);
    expect(carol.filledQuantity).toBe(0);
  });

  it('a crossing limit buy trades at the maker price and gets the price improvement back', () => {
    const { brokerage } = build();
    brokerage.placeOrder(limit('carol', SELL, 10, 10_000));
    const order = brokerage.placeOrder(limit('alice', BUY, 10, 10_500));
    expect(order.status).toBe(OrderStatus.FILLED);
    expect(brokerage.account('alice').availableCash).toBe(CASH - 100_000);
    expect(brokerage.account('alice').reservedCash).toBe(0);
    expect(brokerage.account('carol').availableCash).toBe(CASH + 100_000);
  });

  it('partial fills produce several trades and the remainder rests until filled', () => {
    const { brokerage, trades } = build();
    brokerage.placeOrder(limit('bob', SELL, 4, 10_000));
    brokerage.placeOrder(limit('carol', SELL, 3, 10_050));
    const order = brokerage.placeOrder(limit('alice', BUY, 10, 10_100));
    expect(trades).toHaveLength(2);
    expect(order.status).toBe(OrderStatus.PARTIALLY_FILLED);
    expect(brokerage.account('alice').reservedCash).toBe(3 * 10_100);
    brokerage.placeOrder(limit('dave', SELL, 3, 10_000)); // trades at alice's resting price
    expect(order.status).toBe(OrderStatus.FILLED);
    expect(trades[2].price).toBe(10_100);
    expect(brokerage.account('alice').availableCash).toBe(CASH - 40_000 - 30_150 - 30_300);
    expect(brokerage.account('alice').availableShares('ACME')).toBe(110);
  });

  it('market orders sweep the book, cancel the remainder and are rejected on an empty book', () => {
    const { brokerage, trades } = build();
    brokerage.placeOrder(limit('bob', SELL, 2, 10_000));
    brokerage.placeOrder(limit('carol', SELL, 3, 10_200));
    const sweep = brokerage.placeOrder(market('alice', BUY, 10));
    expect(trades.map((t) => t.price)).toEqual([10_000, 10_200]);
    expect(sweep.status).toBe(OrderStatus.CANCELLED);
    expect(sweep.filledQuantity).toBe(5);
    expect(brokerage.account('alice').availableCash).toBe(CASH - 20_000 - 30_600);
    expect(brokerage.account('alice').reservedCash).toBe(0);
    const lonely = brokerage.placeOrder(market('dave', SELL, 5));
    expect(lonely.status).toBe(OrderStatus.REJECTED);
    expect(brokerage.account('dave').availableShares('ACME')).toBe(100);
  });

  it('a market buy stops at what the buyer can afford', () => {
    const { brokerage } = build();
    brokerage.openAccount('eve').deposit(25_000);
    brokerage.placeOrder(limit('bob', SELL, 5, 10_000));
    const order = brokerage.placeOrder({ ...market('eve', BUY, 5) });
    expect(order.filledQuantity).toBe(2);
    expect(brokerage.account('eve').availableCash).toBe(5_000);
  });
});

describe('reservations', () => {
  it('never lets open orders commit more cash or shares than the user has', () => {
    const { brokerage } = build();
    brokerage.placeOrder(limit('alice', BUY, 300, 10_000)); // reserves Rs 30,000 of 50,000
    expect(() => brokerage.placeOrder(limit('alice', BUY, 250, 10_000))).toThrow(InsufficientFundsError);
    expect(brokerage.account('alice').availableCash).toBe(CASH - 3_000_000);
    brokerage.placeOrder(limit('bob', SELL, 70, 20_000));
    expect(() => brokerage.placeOrder(limit('bob', SELL, 40, 20_000))).toThrow(InsufficientHoldingsError);
    expect(() => brokerage.placeOrder(market('bob', SELL, 31))).toThrow(InsufficientHoldingsError);
  });

  it('cancel restores the reservation and is refused once the order is final', () => {
    const { brokerage } = build();
    const buy = brokerage.placeOrder(limit('alice', BUY, 10, 10_000));
    brokerage.cancelOrder(buy.id);
    expect(brokerage.account('alice').availableCash).toBe(CASH);
    expect(brokerage.account('alice').reservedCash).toBe(0);
    const sell = brokerage.placeOrder(limit('bob', SELL, 10, 10_000));
    brokerage.placeOrder(market('carol', BUY, 4));
    brokerage.cancelOrder(sell.id);
    expect(brokerage.account('bob').availableShares('ACME')).toBe(96);
    expect(brokerage.account('bob').reservedShares('ACME')).toBe(0);
    expect(brokerage.book('ACME').depth(SELL)).toEqual([]);
    expect(() => brokerage.cancelOrder(sell.id)).toThrow(InvalidOrderTransitionError);
    expect(() => brokerage.cancelOrder('ord-404')).toThrow(OrderNotFoundError);
  });
});

describe('fees, valuation and validation', () => {
  it('percentage fees with a minimum add up to fee(total) across partial fills and conserve cash', () => {
    const { brokerage, trades } = build(new PercentageFeeStrategy(30, 2_000)); // 0.3%, min Rs 20
    brokerage.placeOrder(limit('bob', SELL, 30, 10_000));
    brokerage.placeOrder(limit('carol', SELL, 70, 10_000));
    const order = brokerage.placeOrder(limit('alice', BUY, 100, 10_000));
    expect(trades.map((t) => [t.buyerFee, t.sellerFee])).toEqual([[2_000, 2_000], [1_000, 2_100]]);
    expect(order.feesPaid).toBe(3_000);
    expect(brokerage.account('alice').availableCash).toBe(CASH - 1_000_000 - 3_000);
    expect(brokerage.account('bob').availableCash).toBe(CASH + 300_000 - 2_000);
    expect(totalCash(brokerage) + brokerage.feesCollected).toBe(4 * CASH);
  });

  it('a flat fee is charged once per order however many fills it takes', () => {
    const { brokerage, trades } = build(new FlatFeeStrategy(2_000));
    for (const seller of ['bob', 'carol', 'dave']) brokerage.placeOrder(limit(seller, SELL, 3, 10_000));
    brokerage.placeOrder(market('alice', BUY, 9));
    expect(trades.map((t) => t.buyerFee)).toEqual([2_000, 0, 0]);
    expect(trades.every((t) => t.sellerFee === 2_000)).toBe(true);
    expect(brokerage.feesCollected).toBe(8_000);
  });

  it('values a portfolio at the last traded price', () => {
    const { brokerage } = build();
    expect(brokerage.portfolio('alice').positions[0].marketValue).toBe(0); // never traded
    brokerage.placeOrder(limit('bob', SELL, 10, 10_200));
    brokerage.placeOrder(limit('alice', BUY, 10, 10_200));
    brokerage.placeOrder(limit('alice', BUY, 5, 9_000)); // resting: its cash is reserved, still alice's
    const portfolio = brokerage.portfolio('alice');
    expect(brokerage.lastPrice('ACME')).toBe(10_200);
    expect(portfolio.positions).toEqual([{ symbol: 'ACME', quantity: 110, lastPrice: 10_200, marketValue: 1_122_000 }]);
    expect(portfolio.reservedCash).toBe(45_000);
    expect(portfolio.totalValue).toBe(CASH - 102_000 + 1_122_000);
  });

  it('rejects malformed requests and unknown accounts or symbols', () => {
    const { brokerage } = build();
    expect(() => brokerage.placeOrder(limit('alice', BUY, 0, 10_000))).toThrow(InvalidOrderError);
    expect(() => brokerage.placeOrder({ ...market('alice', BUY, 1), type: OrderType.LIMIT })).toThrow(InvalidOrderError);
    expect(() => brokerage.placeOrder({ ...market('alice', BUY, 1), limitPrice: 100 })).toThrow(InvalidOrderError);
    expect(() => brokerage.placeOrder({ ...market('alice', BUY, 1), symbol: 'NOPE' })).toThrow(UnknownSymbolError);
    expect(() => brokerage.placeOrder(market('zed', BUY, 1))).toThrow(AccountNotFoundError);
    expect(() => brokerage.openAccount('alice')).toThrow(DuplicateAccountError);
    expect(brokerage.account('alice').reservedCash).toBe(0);
  });

  it('validates order state transitions', () => {
    const order = new Order('o', 'u', 'ACME', BUY, OrderType.LIMIT, 5, 100, 1, new Date(0));
    order.fill(2, 100, 0);
    expect(order.status).toBe(OrderStatus.PARTIALLY_FILLED);
    expect(() => order.reject()).toThrow(InvalidOrderTransitionError);
    expect(() => order.fill(4, 100, 0)).toThrow(RangeError);
    order.fill(3, 100, 0);
    expect(order.status).toBe(OrderStatus.FILLED);
    expect(() => order.cancel()).toThrow(InvalidOrderTransitionError);
  });
});
