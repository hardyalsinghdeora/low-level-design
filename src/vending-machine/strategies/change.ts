import type { Money } from '../../shared/money';

/**
 * Strategy pattern: how to pay out change from a limited coin stock.
 * Returns the coins (largest first) or undefined when the amount cannot be made.
 */
export interface ChangeStrategy {
  readonly name: string;
  makeChange(amount: Money, stock: ReadonlyMap<Money, number>): Money[] | undefined;
}

function denominationsDesc(stock: ReadonlyMap<Money, number>): Money[] {
  return [...stock.entries()]
    .filter(([, n]) => n > 0)
    .map(([d]) => d)
    .sort((a, b) => b - a);
}

/** Largest coin first. Optimal for canonical coin systems with unlimited stock, but can fail with a bounded stock. */
export class GreedyChangeStrategy implements ChangeStrategy {
  readonly name = 'greedy';

  makeChange(amount: Money, stock: ReadonlyMap<Money, number>): Money[] | undefined {
    const coins: Money[] = [];
    let remaining = amount;
    for (const d of denominationsDesc(stock)) {
      const take = Math.min(stock.get(d) ?? 0, Math.floor(remaining / d));
      for (let i = 0; i < take; i++) coins.push(d);
      remaining -= take * d;
    }
    return remaining === 0 ? coins : undefined;
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Bounded dynamic programming: finds the fewest coins whenever any solution
 * exists, e.g. 600 from {500 x1, 200 x3} where greedy gets stuck on 100.
 * Amounts are scaled by the gcd of the denominations to keep the table small.
 */
export class MinimumCoinsChangeStrategy implements ChangeStrategy {
  readonly name = 'minimum-coins';

  makeChange(amount: Money, stock: ReadonlyMap<Money, number>): Money[] | undefined {
    if (amount === 0) return [];
    const denoms = denominationsDesc(stock);
    const unit = denoms.reduce(gcd, amount);
    const target = amount / unit;

    let best: number[] = Array.from({ length: target + 1 }, (_, a) => (a === 0 ? 0 : Infinity));
    const takes: number[][] = [];
    for (const d of denoms) {
      const step = d / unit;
      const available = stock.get(d) ?? 0;
      const next: number[] = new Array<number>(target + 1).fill(Infinity);
      const take: number[] = new Array<number>(target + 1).fill(0);
      for (let a = 0; a <= target; a++) {
        for (let k = 0; k <= available && k * step <= a; k++) {
          const candidate = (best[a - k * step] ?? Infinity) + k;
          if (candidate < (next[a] ?? Infinity)) {
            next[a] = candidate;
            take[a] = k;
          }
        }
      }
      best = next;
      takes.push(take);
    }
    if (!Number.isFinite(best[target] ?? Infinity)) return undefined;

    const coins: Money[] = [];
    let remaining = target;
    for (let i = denoms.length - 1; i >= 0; i--) {
      const d = denoms[i] ?? 0;
      const k = takes[i]?.[remaining] ?? 0;
      for (let j = 0; j < k; j++) coins.push(d);
      remaining -= k * (d / unit);
    }
    return coins.sort((a, b) => b - a);
  }
}
