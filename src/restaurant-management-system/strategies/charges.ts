import { assertMoney, type Money } from '../../shared/money';

/** Percentages are integer basis points (500 = 5%) and the single rounding step is explicit: half up to the paisa. */
export function percentOf(amount: Money, basisPoints: number): Money {
  assertMoney(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0) throw new RangeError('basisPoints must be a non-negative integer');
  return Math.round((amount * basisPoints) / 10_000);
}

/** Strategy: tax rules differ by country and by dine-in vs take-away. */
export interface TaxStrategy {
  taxOn(amount: Money): Money;
}

export class PercentageTax implements TaxStrategy {
  constructor(private readonly basisPoints: number) {}

  taxOn(amount: Money): Money {
    return percentOf(amount, this.basisPoints);
  }
}

export class NoTax implements TaxStrategy {
  taxOn(): Money {
    return 0;
  }
}

/** Strategy: service charge is house policy (always, large parties only, never). */
export interface ServiceChargeStrategy {
  chargeOn(subtotal: Money, partySize: number): Money;
}

export class PercentageServiceCharge implements ServiceChargeStrategy {
  constructor(private readonly basisPoints: number) {}

  chargeOn(subtotal: Money): Money {
    return percentOf(subtotal, this.basisPoints);
  }
}

export class LargePartyServiceCharge implements ServiceChargeStrategy {
  constructor(
    private readonly basisPoints: number,
    private readonly minPartySize: number,
  ) {}

  chargeOn(subtotal: Money, partySize: number): Money {
    return partySize >= this.minPartySize ? percentOf(subtotal, this.basisPoints) : 0;
  }
}

export class NoServiceCharge implements ServiceChargeStrategy {
  chargeOn(): Money {
    return 0;
  }
}
