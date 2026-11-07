import { InvalidFenError } from './errors';
import { pieceFromLetter } from './pieces/piece-factory';
import { type Color, opposite, type Piece, PieceType } from './pieces/piece';
import { Position } from './position';

export interface PlacedPiece {
  readonly piece: Piece;
  readonly position: Position;
}

export const STANDARD_SETUP = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/**
 * The 8x8 grid. It knows occupancy and attack geometry ("is e1 attacked by
 * black?") but nothing about whose turn it is or what the game status is:
 * that belongs to Game, which keeps the board a reusable value for analysis.
 */
export class Board {
  private readonly squares: (Piece | null)[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, (): Piece | null => null),
  );

  static standard(): Board {
    return Board.fromFen(STANDARD_SETUP);
  }

  /** Reads the piece-placement field of a FEN string, rank 8 first. */
  static fromFen(placement: string): Board {
    const board = new Board();
    const rows = placement.trim().split('/');
    if (rows.length !== 8) throw new InvalidFenError(placement, `expected 8 ranks, got ${rows.length}`);
    rows.forEach((row, index) => {
      const rank = 7 - index;
      let file = 0;
      for (const ch of row) {
        if (/^[1-8]$/.test(ch)) {
          file += Number(ch);
        } else if (/^[pnbrqk]$/i.test(ch) && file < 8) {
          board.place(Position.of(file, rank), pieceFromLetter(ch));
          file += 1;
        } else {
          throw new InvalidFenError(placement, `unexpected "${ch}" on rank ${rank + 1}`);
        }
      }
      if (file !== 8) throw new InvalidFenError(placement, `rank ${rank + 1} has ${file} squares`);
    });
    return board;
  }

  pieceAt(position: Position): Piece | null {
    return this.squares[position.rank][position.file];
  }

  /** Low-level write used by move commands; `null` empties the square. */
  place(position: Position, piece: Piece | null): void {
    this.squares[position.rank][position.file] = piece;
  }

  /** A snapshot, so callers may move pieces while iterating. */
  pieces(color?: Color): PlacedPiece[] {
    const out: PlacedPiece[] = [];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = this.squares[rank][file];
        if (piece && (color === undefined || piece.color === color)) {
          out.push({ piece, position: Position.of(file, rank) });
        }
      }
    }
    return out;
  }

  findKing(color: Color): Position | undefined {
    return this.pieces(color).find(({ piece }) => piece.type === PieceType.KING)?.position;
  }

  isAttacked(target: Position, by: Color): boolean {
    return this.pieces(by).some(({ piece, position }) =>
      piece.attacks(this, position).some((square) => square.equals(target)),
    );
  }

  isInCheck(color: Color): boolean {
    const king = this.findKing(color);
    return king !== undefined && this.isAttacked(king, opposite(color));
  }

  toFen(): string {
    const rows: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.squares[rank][file];
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) row += String(empty);
        empty = 0;
        row += piece.letter;
      }
      rows.push(empty ? row + String(empty) : row);
    }
    return rows.join('/');
  }

  /** Text diagram for demos: uppercase white, lowercase black, '.' empty. */
  toAscii(): string {
    const lines: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      const cells = this.squares[rank].map((piece) => piece?.letter ?? '.');
      lines.push(`${rank + 1} ${cells.join(' ')}`);
    }
    lines.push('  a b c d e f g h');
    return lines.join('\n');
  }
}
