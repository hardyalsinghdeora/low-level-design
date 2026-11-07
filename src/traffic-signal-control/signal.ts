export enum Direction {
  NORTH = 'NORTH',
  SOUTH = 'SOUTH',
  EAST = 'EAST',
  WEST = 'WEST',
}

export enum Axis {
  NORTH_SOUTH = 'NORTH_SOUTH',
  EAST_WEST = 'EAST_WEST',
}

export enum SignalColor {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  RED = 'RED',
}

/** Where the controller is in its cycle. ALL_RED is the clearance interval between phases. */
export enum CycleStage {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  ALL_RED = 'ALL_RED',
}

export const ALL_DIRECTIONS: readonly Direction[] = [Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST];

export function axisOf(direction: Direction): Axis {
  return direction === Direction.NORTH || direction === Direction.SOUTH ? Axis.NORTH_SOUTH : Axis.EAST_WEST;
}

/** Opposite approaches can flow together; crossing approaches cannot. */
export function conflicts(a: Direction, b: Direction): boolean {
  return axisOf(a) !== axisOf(b);
}
