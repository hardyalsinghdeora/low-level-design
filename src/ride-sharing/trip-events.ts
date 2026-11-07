import type { TripStatus } from './trip';

export interface TripEvent {
  readonly tripId: string;
  readonly riderId: string;
  readonly driverId: string | null;
  readonly status: TripStatus;
  readonly at: Date;
}

/** Observer: rider app, driver app and analytics follow trips without the service knowing them. */
export interface TripObserver {
  onTripEvent(event: TripEvent): void;
}

export class TripTimeline implements TripObserver {
  readonly events: TripEvent[] = [];

  onTripEvent(event: TripEvent): void {
    this.events.push(event);
  }

  of(tripId: string): TripStatus[] {
    return this.events.filter((e) => e.tripId === tripId).map((e) => e.status);
  }
}
