import type { Board } from '../board';
import type { Position } from '../position';
import { type Color, type Direction, Piece, PieceType } from './piece';

const DIAGONALS: readonly Direction[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const STRAIGHTS: readonly Direction[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Slides any distance along diagonals. */
export class Bishop extends Piece {
  constructor(color: Color) {
    super(color, PieceType.BISHOP);
  }

  pseudoLegalMoves(board: Board, from: Position): Position[] {
    return this.slide(board, from, DIAGONALS);
  }
}

/** Slides any distance along ranks and files. Castling is out of scope (see the write-up). */
export class Rook extends Piece {
  constructor(color: Color) {
    super(color, PieceType.ROOK);
  }

  pseudoLegalMoves(board: Board, from: Position): Position[] {
    return this.slide(board, from, STRAIGHTS);
  }
}

/** A rook and a bishop in one: the same slide over all eight rays. */
export class Queen extends Piece {
  constructor(color: Color) {
    super(color, PieceType.QUEEN);
  }

  pseudoLegalMoves(board: Board, from: Position): Position[] {
    return this.slide(board, from, [...DIAGONALS, ...STRAIGHTS]);
  }
}
