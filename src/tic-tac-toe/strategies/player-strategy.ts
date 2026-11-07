import type { Board, Position } from '../board';
import { NoMoveProvidedError } from '../errors';
import type { Player } from '../player';

/**
 * Strategy pattern: how a seat picks its next cell. Game asks the current
 * player's strategy and validates the answer like any other move, so it never
 * cares whether a human or a bot is behind it.
 */
export interface PlayerStrategy {
  chooseMove(board: Board, player: Player): Position;
}

/**
 * A human decides outside the program. The UI (or a test) hands each chosen
 * cell over explicitly, and the strategy releases it on the player's turn.
 */
export class HumanMoveStrategy implements PlayerStrategy {
  private readonly pending: Position[] = [];

  choose(row: number, col: number): this {
    this.pending.push({ row, col });
    return this;
  }

  chooseMove(_board: Board, player: Player): Position {
    const next = this.pending.shift();
    if (!next) throw new NoMoveProvidedError(player.name);
    return next;
  }
}

/** Picks uniformly among the empty cells. The rng is injected so games are reproducible. */
export class RandomMoveStrategy implements PlayerStrategy {
  constructor(private readonly rng: () => number = Math.random) {}

  chooseMove(board: Board): Position {
    const empty = board.emptyCells();
    if (empty.length === 0) throw new RangeError('No empty cell to choose from');
    const index = Math.min(empty.length - 1, Math.floor(this.rng() * empty.length));
    return empty[index];
  }
}
