import type { Board } from '../board';
import type { Position } from '../position';

export enum Color {
  WHITE = 'WHITE',
  BLACK = 'BLACK',
}

export function opposite(color: Color): Color {
  return color === Color.WHITE ? Color.BLACK : Color.WHITE;
}

export enum PieceType {
  PAWN = 'PAWN',
  KNIGHT = 'KNIGHT',
  BISHOP = 'BISHOP',
  ROOK = 'ROOK',
  QUEEN = 'QUEEN',
  KING = 'KING',
}

/** FEN letters (lowercase); white pieces use the uppercase form. */
const FEN_LETTER: Record<PieceType, string> = {
  [PieceType.PAWN]: 'p',
  [PieceType.KNIGHT]: 'n',
  [PieceType.BISHOP]: 'b',
  [PieceType.ROOK]: 'r',
  [PieceType.QUEEN]: 'q',
  [PieceType.KING]: 'k',
};

export type Direction = readonly [df: number, dr: number];

/**
 * A piece knows only its own geometry: the squares it could reach on this
 * board, ignoring checks ("pseudo-legal" moves). Whether a move leaves its own
 * king in check is a property of the whole position, so Game decides that.
 */
export abstract class Piece {
  protected constructor(
    readonly color: Color,
    readonly type: PieceType,
  ) {}

  abstract pseudoLegalMoves(board: Board, from: Position): Position[];

  /** Squares this piece attacks. The same as its moves for every piece except the pawn. */
  attacks(board: Board, from: Position): Position[] {
    return this.pseudoLegalMoves(board, from);
  }

  /** Whether arriving on `to` turns this piece into another one. Only pawns say yes. */
  promotesOn(_to: Position): boolean {
    return false;
  }

  /** FEN letter: uppercase for white, lowercase for black. */
  get letter(): string {
    const letter = FEN_LETTER[this.type];
    return this.color === Color.WHITE ? letter.toUpperCase() : letter;
  }

  /** Prefix in move notation: "N" for a knight, nothing for a pawn. */
  get notationPrefix(): string {
    return this.type === PieceType.PAWN ? '' : FEN_LETTER[this.type].toUpperCase();
  }

  protected isEnemy(other: Piece | null): boolean {
    return other !== null && other.color !== this.color;
  }

  /** Bishops, rooks, queens: walk each ray until the edge, stop before a friend, stop on an enemy. */
  protected slide(board: Board, from: Position, directions: readonly Direction[]): Position[] {
    const targets: Position[] = [];
    for (const [df, dr] of directions) {
      let next = from.offset(df, dr);
      while (next) {
        const occupant = board.pieceAt(next);
        if (occupant === null || this.isEnemy(occupant)) targets.push(next);
        if (occupant !== null) break;
        next = next.offset(df, dr);
      }
    }
    return targets;
  }

  /** Knights and kings: every single jump that lands on the board and not on a friend. */
  protected step(board: Board, from: Position, offsets: readonly Direction[]): Position[] {
    const targets: Position[] = [];
    for (const [df, dr] of offsets) {
      const target = from.offset(df, dr);
      if (!target) continue;
      const occupant = board.pieceAt(target);
      if (occupant === null || this.isEnemy(occupant)) targets.push(target);
    }
    return targets;
  }
}
