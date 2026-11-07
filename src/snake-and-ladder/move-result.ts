import type { DiceRoll } from './dice';
import type { Jump } from './jump';

export enum MoveEvent {
  MOVED = 'MOVED',
  LADDER_CLIMBED = 'LADDER_CLIMBED',
  SNAKE_BITTEN = 'SNAKE_BITTEN',
  /** The roll would pass the last cell; the exact-landing rule keeps the token where it was. */
  OVERSHOT = 'OVERSHOT',
  WON = 'WON',
}

/**
 * What happened on one turn, as plain data. A UI, a log or a replay can render
 * it without knowing the rules that produced it.
 */
export interface MoveResult {
  readonly turn: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly roll: DiceRoll;
  readonly from: number;
  /** Where the dice alone point to; past the last cell on an overshoot. */
  readonly landedOn: number;
  /** Where the token actually ends the turn. */
  readonly to: number;
  readonly event: MoveEvent;
  readonly jump?: Jump;
}

/** One human-readable line per turn, for logs and the demo. */
export function describeMove(result: MoveResult): string {
  const rolled = `${result.playerName} rolls ${result.roll.faces.join('+')}`;
  switch (result.event) {
    case MoveEvent.OVERSHOT:
      return `${rolled}: ${result.landedOn} is past the end, stays on ${result.from}`;
    case MoveEvent.LADDER_CLIMBED:
      return `${rolled}: ${result.from} -> ${result.landedOn}, climbs a ladder to ${result.to}`;
    case MoveEvent.SNAKE_BITTEN:
      return `${rolled}: ${result.from} -> ${result.landedOn}, bitten by a snake down to ${result.to}`;
    case MoveEvent.WON:
      return `${rolled}: ${result.from} -> ${result.to}, lands exactly on the last cell and wins`;
    case MoveEvent.MOVED:
      return `${rolled}: ${result.from} -> ${result.to}`;
  }
}
