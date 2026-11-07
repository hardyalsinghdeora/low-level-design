import { assertMoney, type Money } from '../shared/money';
import { InvalidDenominationError } from './errors';

export function sumCoins(coins: readonly Money[]): Money {
  return coins.reduce((sum, c) => sum + c, 0);
}

/** Stock plus extra coins, without mutating either. Used to plan change that may reuse inserted coins. */
export function combineStock(stock: ReadonlyMap<Money, number>, extra: readonly Money[]): Map<Money, number> {
  const combined = new Map(stock);
  for (const coin of extra) combined.set(coin, (combined.get(coin) ?? 0) + 1);
  return combined;
}

/**
 * The cash box: how many coins or notes of each accepted denomination the
 * machine holds. Removing coins that are not there is a bug, so it throws.
 */
export class CoinInventory {
  readonly accepted: readonly Money[];
  private readonly counts = new Map<Money, number>();

  constructor(accepted: readonly Money[], initial: Readonly<Record<number, number>> = {}) {
    for (const d of accepted) {
      assertMoney(d, 'denomination');
      if (d === 0) throw new RangeError('Denomination must be positive');
    }
    this.accepted = [...accepted].sort((a, b) => b - a);
    for (const d of this.accepted) this.counts.set(d, 0);
    for (const [denomination, count] of Object.entries(initial)) {
      this.add(Array.from({ length: count }, () => Number(denomination)));
    }
  }

  isAccepted(coin: Money): boolean {
    return this.counts.has(coin);
  }

  assertAccepted(coin: Money): void {
    if (!this.isAccepted(coin)) throw new InvalidDenominationError(coin);
  }

  add(coins: readonly Money[]): void {
    for (const coin of coins) {
      this.assertAccepted(coin);
      this.counts.set(coin, (this.counts.get(coin) ?? 0) + 1);
    }
  }

  remove(coins: readonly Money[]): void {
    const after = new Map(this.counts);
    for (const coin of coins) {
      const left = (after.get(coin) ?? 0) - 1;
      if (left < 0) throw new RangeError(`Cash box has no ${coin} left`);
      after.set(coin, left);
    }
    for (const [coin, n] of after) this.counts.set(coin, n);
  }

  count(coin: Money): number {
    return this.counts.get(coin) ?? 0;
  }

  stock(): ReadonlyMap<Money, number> {
    return new Map(this.counts);
  }

  total(): Money {
    let sum = 0;
    for (const [coin, n] of this.counts) sum += coin * n;
    return sum;
  }
}
