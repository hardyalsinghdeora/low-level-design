import type { Money } from '../shared/money';
import { InvalidPlanError } from './errors';

export enum BillingInterval {
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export const MONTHS_PER_INTERVAL: Record<BillingInterval, number> = {
  [BillingInterval.MONTH]: 1,
  [BillingInterval.YEAR]: 12,
};

/** What is sold: a recurring price per interval, optionally with a free trial. Immutable; a price change is a new plan. */
export class Plan {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly price: Money,
    readonly interval: BillingInterval,
    readonly trialDays = 0,
  ) {
    if (!name.trim()) throw new InvalidPlanError('A plan needs a name');
    if (!Number.isInteger(price) || price <= 0) throw new InvalidPlanError(`Price must be a positive integer in minor units, got ${price}`);
    if (!Number.isInteger(trialDays) || trialDays < 0) throw new InvalidPlanError(`Trial days must be a non-negative integer, got ${trialDays}`);
  }
}
