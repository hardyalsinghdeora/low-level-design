import { assertMoney, type Money } from '../../shared/money';
import type { TransactionType } from '../transaction';

/**
 * Strategy pattern: how much of each transaction type a user may move per UTC
 * day. Limits change with KYC level and risk scoring, so they stay outside the
 * service.
 */
export interface DailyLimitPolicy {
  /** The user's daily allowance for `type`, or undefined when it is unlimited. */
  limitFor(userId: string, type: TransactionType): Money | undefined;
}

export class NoDailyLimitPolicy implements DailyLimitPolicy {
  limitFor(): Money | undefined {
    return undefined;
  }
}

type Limits = Partial<Record<TransactionType, Money>>;

/** One set of limits for everybody, plus per-user overrides (for example after full KYC). */
export class TieredDailyLimitPolicy implements DailyLimitPolicy {
  private readonly overrides = new Map<string, Limits>();

  constructor(private readonly defaults: Limits) {
    for (const limit of Object.values(defaults)) assertMoney(limit, 'daily limit');
  }

  setUserLimit(userId: string, type: TransactionType, limit: Money): void {
    assertMoney(limit, 'daily limit');
    this.overrides.set(userId, { ...this.overrides.get(userId), [type]: limit });
  }

  limitFor(userId: string, type: TransactionType): Money | undefined {
    return this.overrides.get(userId)?.[type] ?? this.defaults[type];
  }
}

/** Limits reset at 00:00 UTC; "today" always comes from the injected Clock. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
