import type { Money } from '../../shared/money';
import { Party, TripStatus, type Trip } from '../trip';

/** Strategy: what a cancellation costs the rider. */
export interface CancellationFeePolicy {
  fee(trip: Trip, by: Party, at: Date): Money;
}

/**
 * Free while still matching and for a grace period after a driver accepts;
 * after that the rider pays a flat fee for the driver's wasted drive. A
 * driver cancelling never costs the rider.
 */
export class GracePeriodCancellation implements CancellationFeePolicy {
  constructor(
    private readonly fee_: Money,
    private readonly graceMinutes = 2,
  ) {}

  fee(trip: Trip, by: Party, at: Date): Money {
    if (by === Party.DRIVER || trip.status !== TripStatus.ACCEPTED || !trip.acceptedAt) return 0;
    const elapsedMs = at.getTime() - trip.acceptedAt.getTime();
    return elapsedMs <= this.graceMinutes * 60_000 ? 0 : this.fee_;
  }
}
