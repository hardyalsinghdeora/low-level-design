import { assertMoney, type Money } from '../../shared/money';

/** Strategy: how much the next bid must beat the current price by. Real sites tier it by price. */
export interface IncrementPolicy {
  incrementAt(price: Money): Money;
}

/** The same step at every price. Simple, but too coarse for cheap items and too fine for expensive ones. */
export class FixedIncrement implements IncrementPolicy {
  constructor(private readonly step: Money) {
    assertMoney(step, 'step');
    if (step === 0) throw new RangeError('step must be positive');
  }

  incrementAt(): Money {
    return this.step;
  }
}

export interface IncrementTier {
  /** The tier applies from this price upwards, until the next tier starts. */
  from: Money;
  increment: Money;
}

/** eBay-style table: the step grows with the price, e.g. Rs 50 below Rs 1,000, Rs 100 below Rs 5,000. */
export class TieredIncrement implements IncrementPolicy {
  private readonly tiers: readonly IncrementTier[];

  constructor(tiers: IncrementTier[]) {
    this.tiers = [...tiers].sort((a, b) => a.from - b.from);
    if (this.tiers[0]?.from !== 0) throw new RangeError('the first tier must start at 0');
    for (const tier of this.tiers) assertMoney(tier.increment, 'increment');
  }

  incrementAt(price: Money): Money {
    let step = this.tiers[0].increment;
    for (const tier of this.tiers) if (price >= tier.from) step = tier.increment;
    return step;
  }
}
