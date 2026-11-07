import type { Location } from './geo';
import { RatingSummary } from './rating';

/** A passenger. Holds the one active trip so a rider cannot book two cars at once. */
export class Rider {
  readonly ratings = new RatingSummary();
  private _activeTripId: string | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    public location: Location,
  ) {}

  get activeTripId(): string | null {
    return this._activeTripId;
  }

  beginTrip(tripId: string): void {
    this._activeTripId = tripId;
  }

  endTrip(): void {
    this._activeTripId = null;
  }
}
