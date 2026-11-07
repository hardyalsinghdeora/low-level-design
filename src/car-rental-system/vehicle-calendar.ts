import type { DateRange } from './date-range';
import { VehicleUnavailableError } from './errors';
import type { Reservation } from './reservation';

/**
 * All reservations of one vehicle. It is the single gate for new bookings, so
 * "no overlapping reservations per vehicle" is enforced in exactly one place.
 * The database equivalent is an exclusion constraint on (vehicle_id, period).
 */
export class VehicleCalendar {
  private readonly reservations: Reservation[] = [];

  constructor(readonly vehicleId: string) {}

  isFree(period: DateRange): boolean {
    return this.clashWith(period) === undefined;
  }

  assertFree(period: DateRange): void {
    const clash = this.clashWith(period);
    if (clash) {
      throw new VehicleUnavailableError(this.vehicleId, `reservation ${clash.id} holds it for ${clash.period}`);
    }
  }

  /** Compare-and-set: re-checks at insert time, so a stale search result can never double-book. */
  book(reservation: Reservation): void {
    if (reservation.vehicle.id !== this.vehicleId) {
      throw new RangeError(`Reservation ${reservation.id} is for ${reservation.vehicle.id}, not ${this.vehicleId}`);
    }
    this.assertFree(reservation.period);
    this.reservations.push(reservation);
  }

  private clashWith(period: DateRange): Reservation | undefined {
    return this.reservations.find((r) => r.holdsVehicle && r.period.overlaps(period));
  }
}
