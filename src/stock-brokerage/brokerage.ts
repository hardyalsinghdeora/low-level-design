import { SystemClock, type Clock } from '../shared/clock';
import { UuidGenerator, type IdGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { Account } from './account';
import { AccountNotFoundError, DuplicateAccountError, InsufficientFundsError, OrderNotFoundError, UnknownSymbolError } from './errors';
import { Order, OrderSide, OrderType } from './order';
import { OrderBook } from './order-book';
import { ZeroFeeStrategy, type FeeStrategy } from './strategies/fee';
import type { ExecutionListener, Trade } from './trade';

export interface OrderRequest {
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: Money;
}

export interface Position {
  readonly symbol: string;
  readonly quantity: number;
  readonly lastPrice: Money | undefined;
  /** quantity x last traded price; 0 while the symbol has never traded. */
  readonly marketValue: Money;
}

export interface Portfolio {
  readonly userId: string;
  readonly availableCash: Money;
  readonly reservedCash: Money;
  readonly positions: Position[];
  readonly totalValue: Money;
}

export interface BrokerageOptions {
  clock?: Clock;
  ids?: IdGenerator;
  feeStrategy?: FeeStrategy;
}

/**
 * Aggregate root and matching engine. Placement reserves what the order could
 * consume, matching moves reserved value between accounts trade by trade, and
 * every exit path (fill, cancel, market remainder, rejection) releases what is left.
 */
export class Brokerage {
  private readonly accounts = new Map<string, Account>();
  private readonly books = new Map<string, OrderBook>();
  private readonly orders = new Map<string, Order>();
  private readonly lastPrices = new Map<string, Money>();
  private readonly listeners = new Set<ExecutionListener>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly fees: FeeStrategy;
  private sequence = 0;
  private _feesCollected: Money = 0;

  constructor(options: BrokerageOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.fees = options.feeStrategy ?? new ZeroFeeStrategy();
  }

  get feesCollected(): Money {
    return this._feesCollected;
  }

  openAccount(userId: string): Account {
    if (this.accounts.has(userId)) throw new DuplicateAccountError(userId);
    const account = new Account(userId);
    this.accounts.set(userId, account);
    return account;
  }

  account(userId: string): Account {
    const account = this.accounts.get(userId);
    if (!account) throw new AccountNotFoundError(userId);
    return account;
  }

  listSymbol(symbol: string): OrderBook {
    const book = this.books.get(symbol) ?? new OrderBook(symbol);
    this.books.set(symbol, book);
    return book;
  }

  book(symbol: string): OrderBook {
    const book = this.books.get(symbol);
    if (!book) throw new UnknownSymbolError(symbol);
    return book;
  }

  order(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }

  lastPrice(symbol: string): Money | undefined {
    return this.lastPrices.get(symbol);
  }

  subscribe(listener: ExecutionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  placeOrder(request: OrderRequest): Order {
    const account = this.account(request.userId);
    const book = this.book(request.symbol);
    const order = new Order(
      this.ids.next('ord'), request.userId, request.symbol, request.side, request.type,
      request.quantity, request.limitPrice, ++this.sequence, this.clock.now(),
    );
    this.reserve(account, order);
    this.orders.set(order.id, order);
    this.match(order, book);

    if (order.type === OrderType.MARKET && order.remaining > 0) {
      // Market orders never rest: no liquidity at all is a rejection, a thin book cancels the rest.
      if (order.filledQuantity === 0) order.reject();
      else order.cancel();
      this.releaseRemainder(order);
    } else if (order.remaining > 0) {
      book.add(order);
    }
    return order;
  }

  cancelOrder(orderId: string): Order {
    const order = this.order(orderId);
    order.cancel();
    this.book(order.symbol).remove(order.id);
    this.releaseRemainder(order);
    return order;
  }

  portfolio(userId: string): Portfolio {
    const account = this.account(userId);
    const positions = [...account.positions()].map(([symbol, quantity]) => {
      const lastPrice = this.lastPrices.get(symbol);
      return { symbol, quantity, lastPrice, marketValue: quantity * (lastPrice ?? 0) };
    });
    const holdingsValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
    return {
      userId,
      availableCash: account.availableCash,
      reservedCash: account.reservedCash,
      positions,
      totalValue: account.availableCash + account.reservedCash + holdingsValue,
    };
  }

  /** Fee for executing `notional` more on this order, never letting total fees exceed executed value. */
  private incrementalFee(order: Order, notional: Money): Money {
    const after = order.executedNotional + notional;
    return Math.min(after, this.fees.feeFor(after)) - order.feesPaid;
  }

  private reserve(account: Account, order: Order): void {
    if (order.side === OrderSide.SELL) {
      account.reserveShares(order.symbol, order.quantity);
      return;
    }
    // A limit buy reserves its worst case; a market buy has no price cap, so it may use all available cash.
    const amount =
      order.limitPrice !== undefined
        ? order.quantity * order.limitPrice + this.incrementalFee(order, order.quantity * order.limitPrice)
        : account.availableCash;
    if (amount === 0) throw new InsufficientFundsError(account.userId, 0, 1);
    account.reserveCash(amount);
    order.holdCash(amount);
  }

  private match(taker: Order, book: OrderBook): void {
    while (taker.remaining > 0) {
      const maker = book.bestOpposite(taker.side);
      if (!maker || maker.limitPrice === undefined || !taker.accepts(maker.limitPrice)) return;
      const quantity = this.affordable(taker, maker.limitPrice, Math.min(taker.remaining, maker.remaining));
      if (quantity === 0) return;
      this.execute(taker, maker, maker.limitPrice, quantity);
      if (!maker.isActive) book.remove(maker.id);
    }
  }

  /** Largest quantity a market buy can still pay for, fees included; other orders were reserved in full. */
  private affordable(taker: Order, price: Money, wanted: number): number {
    if (taker.side !== OrderSide.BUY || taker.type !== OrderType.MARKET) return wanted;
    let quantity = Math.min(wanted, Math.floor(taker.reservedCash / price));
    while (quantity > 0 && quantity * price + this.incrementalFee(taker, quantity * price) > taker.reservedCash) quantity -= 1;
    return quantity;
  }

  private execute(taker: Order, maker: Order, price: Money, quantity: number): void {
    const [buy, sell] = taker.side === OrderSide.BUY ? [taker, maker] : [maker, taker];
    const notional = quantity * price;
    const buyerFee = this.incrementalFee(buy, notional);
    const sellerFee = this.incrementalFee(sell, notional);
    const buyer = this.account(buy.userId);
    const seller = this.account(sell.userId);

    buy.consumeCash(notional + buyerFee);
    buyer.spendReservedCash(notional + buyerFee);
    buyer.depositShares(buy.symbol, quantity);
    seller.deliverReservedShares(sell.symbol, quantity);
    seller.credit(notional - sellerFee);
    this._feesCollected += buyerFee + sellerFee;

    buy.fill(quantity, price, buyerFee);
    sell.fill(quantity, price, sellerFee);
    this.releaseExcess(buy, buyer);
    this.lastPrices.set(buy.symbol, price);

    const trade: Trade = {
      id: this.ids.next('trd'), symbol: buy.symbol, price, quantity,
      buyOrderId: buy.id, sellOrderId: sell.id, buyerId: buy.userId, sellerId: sell.userId,
      buyerFee, sellerFee, executedAt: this.clock.now(),
    };
    for (const listener of this.listeners) listener.onExecution(trade);
  }

  /**
   * After a fill, a buy keeps only the worst case for what is left (remaining x limit
   * plus fees); the price improvement goes back to available cash straight away.
   */
  private releaseExcess(buy: Order, buyer: Account): void {
    if (!buy.isActive) return this.releaseRemainder(buy);
    if (buy.limitPrice === undefined) return; // a market buy releases everything when it finishes
    const worstCase = buy.remaining * buy.limitPrice;
    const required = worstCase + this.incrementalFee(buy, worstCase);
    if (buy.reservedCash > required) buyer.releaseCash(buy.releaseCash(buy.reservedCash - required));
  }

  private releaseRemainder(order: Order): void {
    const account = this.account(order.userId);
    if (order.side === OrderSide.BUY) {
      const cash = order.releaseCash();
      if (cash > 0) account.releaseCash(cash);
    } else if (order.remaining > 0) {
      account.releaseShares(order.symbol, order.remaining);
    }
  }
}
