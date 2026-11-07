import type { Money } from '../../shared/money';
import { allocateByWeights } from '../allocation';
import { InvalidSplitError } from '../errors';

export enum SplitType {
  EQUAL = 'EQUAL',
  EXACT = 'EXACT',
  PERCENT = 'PERCENT',
  SHARES = 'SHARES',
}

/** One participant of a split. `value` is ignored for EQUAL, an amount for EXACT, a percentage for PERCENT, a weight for SHARES. */
export interface SplitEntry {
  readonly userId: string;
  readonly value?: number;
}

/**
 * Turns an expense amount plus the user's split input into exact integer shares.
 * Every implementation either returns shares that add up to `amount` or throws
 * InvalidSplitError; the expense never sees a split that does not balance.
 */
export interface SplitStrategy {
  readonly type: SplitType;
  split(amount: Money, entries: readonly SplitEntry[]): Map<string, Money>;
}

function assertParticipants(entries: readonly SplitEntry[]): void {
  if (entries.length === 0) throw new InvalidSplitError('A split needs at least one participant');
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.userId)) throw new InvalidSplitError(`${entry.userId} appears twice in the split`);
    seen.add(entry.userId);
  }
}

function valueOf(entry: SplitEntry, type: SplitType): number {
  if (entry.value === undefined) throw new InvalidSplitError(`A ${type} split needs a value for ${entry.userId}`);
  return entry.value;
}

function zip(entries: readonly SplitEntry[], parts: readonly Money[]): Map<string, Money> {
  return new Map(entries.map((entry, index) => [entry.userId, parts[index]]));
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** Same share for everyone; the leftover paise go to the first participants (100 / 3 = 34, 33, 33). */
export class EqualSplitStrategy implements SplitStrategy {
  readonly type = SplitType.EQUAL;

  split(amount: Money, entries: readonly SplitEntry[]): Map<string, Money> {
    assertParticipants(entries);
    return zip(entries, allocateByWeights(amount, entries.map(() => 1)));
  }
}

/** The user typed every share; they must add up to the total to the paisa. */
export class ExactSplitStrategy implements SplitStrategy {
  readonly type = SplitType.EXACT;

  split(amount: Money, entries: readonly SplitEntry[]): Map<string, Money> {
    assertParticipants(entries);
    const parts = entries.map((entry) => {
      const value = valueOf(entry, this.type);
      if (!Number.isInteger(value) || value < 0) {
        throw new InvalidSplitError(`Exact share for ${entry.userId} must be a non-negative integer, got ${value}`);
      }
      return value;
    });
    if (sum(parts) !== amount) throw new InvalidSplitError(`Exact shares add up to ${sum(parts)}, expected ${amount}`);
    return zip(entries, parts);
  }
}

const FULL_BASIS_POINTS = 10_000;

/**
 * Percentages with at most two decimals, converted to integer basis points so the
 * "adds up to 100%" check is exact (33.33 + 33.33 + 33.34 is 10,000 bps, not 99.99999).
 */
export class PercentSplitStrategy implements SplitStrategy {
  readonly type = SplitType.PERCENT;

  split(amount: Money, entries: readonly SplitEntry[]): Map<string, Money> {
    assertParticipants(entries);
    const basisPoints = entries.map((entry) => {
      const value = valueOf(entry, this.type);
      const bps = Math.round(value * 100);
      if (value < 0 || Math.abs(value * 100 - bps) > 1e-6) {
        throw new InvalidSplitError(`Percentage for ${entry.userId} must be non-negative with at most two decimals, got ${value}`);
      }
      return bps;
    });
    const total = sum(basisPoints);
    if (total !== FULL_BASIS_POINTS) throw new InvalidSplitError(`Percentages add up to ${total / 100}%, expected 100%`);
    return zip(entries, allocateByWeights(amount, basisPoints));
  }
}

/** Integer weights ("Asha had 2 nights, Ravi 3"); the amount is divided in proportion. */
export class SharesSplitStrategy implements SplitStrategy {
  readonly type = SplitType.SHARES;

  split(amount: Money, entries: readonly SplitEntry[]): Map<string, Money> {
    assertParticipants(entries);
    const weights = entries.map((entry) => {
      const value = valueOf(entry, this.type);
      if (!Number.isInteger(value) || value <= 0) {
        throw new InvalidSplitError(`Share count for ${entry.userId} must be a positive integer, got ${value}`);
      }
      return value;
    });
    return zip(entries, allocateByWeights(amount, weights));
  }
}

export function defaultSplitStrategies(): SplitStrategy[] {
  return [new EqualSplitStrategy(), new ExactSplitStrategy(), new PercentSplitStrategy(), new SharesSplitStrategy()];
}
