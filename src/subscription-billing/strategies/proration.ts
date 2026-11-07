import type { Money } from '../../shared/money';
import { DAY_MS, wholeDaysBetween } from '../billing-calendar';
import type { LineItem } from '../invoice';
import type { Plan } from '../plan';

export interface ProrationInput {
  readonly oldPlan: Plan;
  readonly newPlan: Plan;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly changeAt: Date;
}

/** Decides what a mid-period plan change costs right now. An empty list means "nothing until renewal". */
export interface ProrationStrategy {
  readonly name: string;
  lineItems(input: ProrationInput): LineItem[];
}

/**
 * Value of the last `remainingDays` of a period whose price is spread over
 * `totalDays`. The price is allocated day by day: every day gets floor(price / days)
 * and the first (price mod days) days get one extra unit. Used + unused therefore
 * always equals the price exactly; no paisa is created or lost by rounding.
 */
export function unusedValue(price: Money, totalDays: number, remainingDays: number): Money {
  const base = Math.floor(price / totalDays);
  const extraDays = price - base * totalDays;
  const extraInRemaining = Math.max(0, extraDays - (totalDays - remainingDays));
  return remainingDays * base + extraInRemaining;
}

/** Credits the unused days of the old plan and charges the same days at the new plan's rate. A partly used day counts as used. */
export class DailyProrationStrategy implements ProrationStrategy {
  readonly name = 'daily';

  lineItems({ oldPlan, newPlan, periodStart, periodEnd, changeAt }: ProrationInput): LineItem[] {
    const totalDays = wholeDaysBetween(periodStart, periodEnd);
    const usedDays = Math.ceil((changeAt.getTime() - periodStart.getTime()) / DAY_MS);
    const remainingDays = totalDays - Math.min(totalDays, Math.max(0, usedDays));
    if (remainingDays <= 0) return [];
    const days = `${remainingDays}/${totalDays} days`;
    return [
      { description: `Unused time on ${oldPlan.name} (${days})`, amount: -unusedValue(oldPlan.price, totalDays, remainingDays) },
      { description: `Remaining time on ${newPlan.name} (${days})`, amount: unusedValue(newPlan.price, totalDays, remainingDays) },
    ];
  }
}

/** The new price simply applies from the next renewal. */
export class NoProrationStrategy implements ProrationStrategy {
  readonly name = 'none';

  lineItems(): LineItem[] {
    return [];
  }
}
