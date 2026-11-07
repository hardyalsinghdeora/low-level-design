export enum Direction {
  UP = 'UP',
  DOWN = 'DOWN',
}

export enum ElevatorState {
  IDLE = 'IDLE',
  MOVING_UP = 'MOVING_UP',
  MOVING_DOWN = 'MOVING_DOWN',
  DOOR_OPEN = 'DOOR_OPEN',
  MAINTENANCE = 'MAINTENANCE',
}

const ALLOWED: Record<ElevatorState, readonly ElevatorState[]> = {
  [ElevatorState.IDLE]: [ElevatorState.MOVING_UP, ElevatorState.MOVING_DOWN, ElevatorState.DOOR_OPEN, ElevatorState.MAINTENANCE],
  [ElevatorState.MOVING_UP]: [ElevatorState.DOOR_OPEN, ElevatorState.IDLE],
  [ElevatorState.MOVING_DOWN]: [ElevatorState.DOOR_OPEN, ElevatorState.IDLE],
  [ElevatorState.DOOR_OPEN]: [ElevatorState.IDLE, ElevatorState.MOVING_UP, ElevatorState.MOVING_DOWN],
  [ElevatorState.MAINTENANCE]: [ElevatorState.IDLE],
};

/** Moving cars never go straight to MAINTENANCE, and never reverse without stopping first. */
export function canTransition(from: ElevatorState, to: ElevatorState): boolean {
  return ALLOWED[from].includes(to);
}

export function movingState(direction: Direction): ElevatorState {
  return direction === Direction.UP ? ElevatorState.MOVING_UP : ElevatorState.MOVING_DOWN;
}
