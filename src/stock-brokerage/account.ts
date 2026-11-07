import type { Money } from '../shared/money';
import { InsufficientFundsError, InsufficientHoldingsError } from './errors';

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer, got ${value}`);
}

/**
 * A user's cash and shares, each split into available and reserved. Placing an
 * order moves value from available to reserved, so two open orders can never
 * spend the same rupee or sell the same share. Every method keeps both halves >= 0.
 */
export class Account {
  private _availableCash: Money = 0;
  private _reservedCash: Money = 0;
  private readonly available = new Map<string, number>();
  private readonly reserved = new Map<string, number>();

  constructor(readonly userId: string) {}

  get availableCash(): Money {
    return this._availableCash;
  }

  get reservedCash(): Money {
    return this._reservedCash;
  }

  deposit(amount: Money): void {
    assertPositiveInteger(amount, 'deposit');
    this._availableCash += amount;
  }

  reserveCash(amount: Money): void {
    if (amount > this._availableCash) throw new InsufficientFundsError(this.userId, this._availableCash, amount);
    this._availableCash -= amount;
    this._reservedCash += amount;
  }

  releaseCash(amount: Money): void {
    this.takeReservedCash(amount);
    this._availableCash += amount;
  }

  /** A fill pays out of the reservation made when the order was placed. */
  spendReservedCash(amount: Money): void {
    this.takeReservedCash(amount);
  }

  credit(amount: Money): void {
    if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`credit must be a non-negative integer, got ${amount}`);
    this._availableCash += amount;
  }

  availableShares(symbol: string): number {
    return this.available.get(symbol) ?? 0;
  }

  reservedShares(symbol: string): number {
    return this.reserved.get(symbol) ?? 0;
  }

  depositShares(symbol: string, quantity: number): void {
    assertPositiveInteger(quantity, 'quantity');
    this.add(this.available, symbol, quantity);
  }

  reserveShares(symbol: string, quantity: number): void {
    const free = this.availableShares(symbol);
    if (quantity > free) throw new InsufficientHoldingsError(this.userId, symbol, free, quantity);
    this.add(this.available, symbol, -quantity);
    this.add(this.reserved, symbol, quantity);
  }

  releaseShares(symbol: string, quantity: number): void {
    this.takeReservedShares(symbol, quantity);
    this.add(this.available, symbol, quantity);
  }

  deliverReservedShares(symbol: string, quantity: number): void {
    this.takeReservedShares(symbol, quantity);
  }

  /** Total shares held per symbol (available + reserved), for valuation. */
  positions(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const map of [this.available, this.reserved]) {
      for (const [symbol, quantity] of map) totals.set(symbol, (totals.get(symbol) ?? 0) + quantity);
    }
    return new Map([...totals].filter(([, quantity]) => quantity > 0).sort(([a], [b]) => a.localeCompare(b)));
  }

  private takeReservedCash(amount: Money): void {
    if (!Number.isInteger(amount) || amount < 0 || amount > this._reservedCash) {
      throw new RangeError(`cannot take ${amount} from reserved cash ${this._reservedCash}`);
    }
    this._reservedCash -= amount;
  }

  private takeReservedShares(symbol: string, quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > this.reservedShares(symbol)) {
      throw new RangeError(`cannot take ${quantity} ${symbol} from ${this.reservedShares(symbol)} reserved`);
    }
    this.add(this.reserved, symbol, -quantity);
  }

  private add(map: Map<string, number>, symbol: string, delta: number): void {
    const next = (map.get(symbol) ?? 0) + delta;
    if (next === 0) map.delete(symbol);
    else map.set(symbol, next);
  }
}
