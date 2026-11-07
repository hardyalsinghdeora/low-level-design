import { HumanMoveStrategy, type PlayerStrategy } from './strategies/player-strategy';

export enum PlayerSymbol {
  X = 'X',
  O = 'O',
}

/**
 * A seat at the table. The symbol is the player's identity on the board; the
 * strategy decides *how* the next cell is picked (a human clicking, a bot).
 */
export class Player {
  constructor(
    readonly name: string,
    readonly symbol: PlayerSymbol,
    readonly strategy: PlayerStrategy = new HumanMoveStrategy(),
  ) {
    if (!name.trim()) throw new RangeError('name is required');
  }
}
