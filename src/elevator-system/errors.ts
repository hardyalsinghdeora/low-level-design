import { DomainError } from '../shared/errors';

export class InvalidFloorError extends DomainError {
  constructor(floor: number, detail = 'is outside the building') {
    super(`Floor ${floor} ${detail}`);
  }
}

export class InvalidElevatorTransitionError extends DomainError {
  constructor(elevatorId: string, from: string, to: string) {
    super(`Elevator ${elevatorId} cannot go ${from} -> ${to}`);
  }
}

export class InvalidElevatorOperationError extends DomainError {
  constructor(elevatorId: string, operation: string, state: string) {
    super(`Elevator ${elevatorId} cannot ${operation} while ${state}`);
  }
}

export class CapacityExceededError extends DomainError {
  constructor(elevatorId: string, capacity: number, wouldBe: number) {
    super(`Elevator ${elevatorId} holds ${capacity} people, not ${wouldBe}`);
  }
}

export class NoElevatorAvailableError extends DomainError {
  constructor(floor: number) {
    super(`No elevator can serve floor ${floor} right now`);
  }
}

export class ElevatorNotFoundError extends DomainError {
  constructor(id: string) {
    super(`No elevator ${id}`);
  }
}
