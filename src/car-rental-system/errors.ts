import { DomainError } from '../shared/errors';
import type { ReservationStatus } from './reservation';

export class CarRentalError extends DomainError {}

export class StoreNotFoundError extends CarRentalError {
  constructor(storeId: string) {
    super(`No store ${storeId}`);
  }
}

export class VehicleNotFoundError extends CarRentalError {
  constructor(vehicleId: string) {
    super(`No vehicle ${vehicleId}`);
  }
}

export class ReservationNotFoundError extends CarRentalError {
  constructor(reservationId: string) {
    super(`No reservation ${reservationId}`);
  }
}

export class InvalidRentalPeriodError extends CarRentalError {
  constructor(reason: string) {
    super(`Invalid rental period: ${reason}`);
  }
}

export class VehicleUnavailableError extends CarRentalError {
  constructor(vehicleId: string, reason: string) {
    super(`Vehicle ${vehicleId} is not available: ${reason}`);
  }
}

export class VehicleNotAtStoreError extends CarRentalError {
  constructor(vehicleId: string, pickupStoreId: string, actualStoreId: string) {
    super(`Vehicle ${vehicleId} is at ${actualStoreId}, not at pickup store ${pickupStoreId}`);
  }
}

export class OutsidePickupWindowError extends CarRentalError {
  constructor(reservationId: string, at: Date) {
    super(`Reservation ${reservationId} cannot be picked up at ${at.toISOString()}`);
  }
}

export class InvalidReservationTransitionError extends CarRentalError {
  constructor(reservationId: string, from: ReservationStatus, to: ReservationStatus) {
    super(`Reservation ${reservationId} cannot go from ${from} to ${to}`);
  }
}
