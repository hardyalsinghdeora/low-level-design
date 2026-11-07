import type { Direction } from './elevator-state';

/** Pressed on a landing: "I am on floor 5 and want to go down". */
export interface HallCall {
  floor: number;
  direction: Direction;
}

export interface HallAssignment {
  requestId: string;
  floor: number;
  direction: Direction;
  elevatorId: string;
  requestedAt: Date;
  /** Simulation step at which the assigned car opened its door at the floor. */
  servedAtStep?: number;
}
