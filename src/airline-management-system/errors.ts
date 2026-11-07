import { DomainError } from '../shared/errors';

export class AirlineError extends DomainError {}

export class FlightInstanceNotFoundError extends AirlineError {
  constructor(instanceId: string) {
    super(`No flight instance ${instanceId}`);
  }
}

export class BookingNotFoundError extends AirlineError {
  constructor(pnr: string) {
    super(`No booking ${pnr}`);
  }
}

export class UnknownSeatError extends AirlineError {
  constructor(seatNumber: string, aircraft: string) {
    super(`Aircraft ${aircraft} has no seat ${seatNumber}`);
  }
}

export class SeatAlreadyAssignedError extends AirlineError {
  constructor(seatNumber: string, instanceId: string) {
    super(`Seat ${seatNumber} on ${instanceId} is already assigned`);
  }
}

export class InvalidBookingRequestError extends AirlineError {}

export class FlightDepartedError extends AirlineError {
  constructor(instanceId: string) {
    super(`Flight ${instanceId} has already departed`);
  }
}

export class InvalidBookingTransitionError extends AirlineError {
  constructor(pnr: string, from: string, to: string) {
    super(`Booking ${pnr} cannot move from ${from} to ${to}`);
  }
}

export class CheckInWindowError extends AirlineError {
  constructor(pnr: string, opensAt: Date, closesAt: Date) {
    super(`Check-in for ${pnr} is open from ${opensAt.toISOString()} to ${closesAt.toISOString()}`);
  }
}
