import type { Board } from '../board';
import type { Position } from '../position';
import { type Color, type Direction, Piece, PieceType } from './piece';

const AROUND: readonly Direction[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/**
 * One step in any direction. Stepping into check is filtered out by Game like
 * any other self-check; castling is deliberately out of scope (a CastlingMove
 * command would add it, see the write-up).
 */
export class King extends Piece {
  constructor(color: Color) {
    super(color, PieceType.KING);
  }

  pseudoLegalMoves(board: Board, from: Position): Position[] {
    return this.step(board, from, AROUND);
  }
}
