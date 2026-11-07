import type { Board } from '../board';
import type { Position } from '../position';
import { type Color, type Direction, Piece, PieceType } from './piece';

const L_SHAPES: readonly Direction[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

/** Jumps in an L and ignores whatever stands in between. */
export class Knight extends Piece {
  constructor(color: Color) {
    super(color, PieceType.KNIGHT);
  }

  pseudoLegalMoves(board: Board, from: Position): Position[] {
    return this.step(board, from, L_SHAPES);
  }
}
