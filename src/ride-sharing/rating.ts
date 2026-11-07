import { InvalidRatingError } from './errors';

/** Running average of 1-5 star ratings. Stored as sum and count so it never drifts from rounding. */
export class RatingSummary {
  private sum = 0;
  private _count = 0;

  constructor(private readonly prior = 5) {}

  add(stars: number): void {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new InvalidRatingError(`stars must be 1-5, got ${stars}`);
    this.sum += stars;
    this._count += 1;
  }

  get count(): number {
    return this._count;
  }

  /** New users start at the prior so they are not ranked last before their first trip. */
  get average(): number {
    return this._count === 0 ? this.prior : Math.round((this.sum / this._count) * 100) / 100;
  }
}
