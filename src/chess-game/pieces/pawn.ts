import type { Board } from '../board';
import type { Position } from '../position';
import { Color, Piece, PieceType } from './piece';

/**
 * The only piece whose captures differ from its moves: it pushes forward onto
 * empty squares (two from its starting rank), and captures one square
 * diagonally forward. Promotion is reported via `promotesOn`; Game turns that
 * into a PromotionMove. En passant is out of scope (see the write-up).
 */
export class Pawn extends Piece {
  constructor(color: Color) {
    super(color, PieceType.PAWN);
  }

  get direction(): number {
    return this.color === Color.WHITE ? 1 : -1;
  }

  get startRank(): number {
    return this.color === Color.WHITE ? 1 : 6;
  }

  get promotionRank(): number {
    return this.color === Color.WHITE ? 7 : 0;
  }

  pseudoLegalMoves(board: Board, from: Position): Position[] {
    const moves: Position[] = [];
    const one = from.offset(0, this.direction);
    if (one && board.pieceAt(one) === null) {
      moves.push(one);
      const two = from.offset(0, 2 * this.direction);
      if (from.rank === this.startRank && two && board.pieceAt(two) === null) moves.push(two);
    }
    for (const target of this.attacks(board, from)) {
      if (this.isEnemy(board.pieceAt(target))) moves.push(target);
    }
    return moves;
  }

  /** Both forward diagonals, occupied or not: that is what makes a square unsafe for the enemy king. */
  override attacks(_board: Board, from: Position): Position[] {
    return [-1, 1]
      .map((df) => from.offset(df, this.direction))
      .filter((target): target is Position => target !== undefined);
  }

  override promotesOn(to: Position): boolean {
    return to.rank === this.promotionRank;
  }
}
