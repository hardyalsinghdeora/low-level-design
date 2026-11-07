import { DomainError } from '../shared/errors';
import type { DriverStatus } from './driver';
import type { TripStatus } from './trip';

export class RideSharingError extends DomainError {}

export class NotFoundError extends RideSharingError {
  constructor(kind: string, id: string) {
    super(`No ${kind} ${id}`);
  }
}

export class NoDriverAvailableError extends RideSharingError {
  constructor(tripId: string) {
    super(`No driver available for trip ${tripId}`);
  }
}

export class DriverUnavailableError extends RideSharingError {
  constructor(driverId: string, status: DriverStatus) {
    super(`Driver ${driverId} is ${status}`);
  }
}

export class RiderHasActiveTripError extends RideSharingError {
  constructor(riderId: string, tripId: string) {
    super(`Rider ${riderId} already has active trip ${tripId}`);
  }
}

export class InvalidTripTransitionError extends RideSharingError {
  constructor(tripId: string, from: TripStatus, to: TripStatus) {
    super(`Trip ${tripId} cannot go from ${from} to ${to}`);
  }
}

export class NotAssignedDriverError extends RideSharingError {
  constructor(tripId: string, driverId: string) {
    super(`Driver ${driverId} is not assigned to trip ${tripId}`);
  }
}

export class InvalidRatingError extends RideSharingError {
  constructor(reason: string) {
    super(`Invalid rating: ${reason}`);
  }
}
