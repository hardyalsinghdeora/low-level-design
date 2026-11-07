import { DomainError } from '../shared/errors';

export class ParkingLotError extends DomainError {}

export class NoSpotAvailableError extends ParkingLotError {
  constructor(licensePlate: string) {
    super(`No available spot for vehicle ${licensePlate}`);
  }
}

export class VehicleAlreadyParkedError extends ParkingLotError {
  constructor(licensePlate: string) {
    super(`Vehicle ${licensePlate} is already parked`);
  }
}

export class TicketNotFoundError extends ParkingLotError {
  constructor(ticketId: string) {
    super(`No active ticket ${ticketId}`);
  }
}

export class TicketAlreadyClosedError extends ParkingLotError {
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} is already closed`);
  }
}

export class SpotOccupiedError extends ParkingLotError {
  constructor(spotId: string) {
    super(`Spot ${spotId} is already occupied`);
  }
}

export class SpotEmptyError extends ParkingLotError {
  constructor(spotId: string) {
    super(`Spot ${spotId} is empty`);
  }
}

export class VehicleDoesNotFitError extends ParkingLotError {
  constructor(licensePlate: string, spotId: string) {
    super(`Vehicle ${licensePlate} does not fit in spot ${spotId}`);
  }
}
