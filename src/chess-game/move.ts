import type { Board } from './board';
import { InvalidPromotionError } from './errors';
import { createPiece } from './pieces/piece-factory';
import { type Piece, PieceType } from './pieces/piece';
import type { Position } from './position';

/**
 * Command pattern: a move knows how to apply itself and how to take itself
 * back. Game uses that twice: to try a move and reject it if it leaves the
 * king in check, and to keep an undoable history.
 */
export interface MoveCommand {
  readonly piece: Piece;
  readonly from: Position;
  readonly to: Position;
  readonly captured: Piece | null;
  execute(board: Board): void;
  undo(board: Board): void;
  /** Long algebraic notation without the check suffix, e.g. "Qh5xf7" or "a7-a8=Q". */
  describe(): string;
}

/** A piece leaves `from` and lands on `to`, capturing whatever stood there. */
export class StandardMove implements MoveCommand {
  private capturedPiece: Piece | null = null;
  private executed = false;

  constructor(
    readonly piece: Piece,
    readonly from: Position,
    readonly to: Position,
  ) {}

  get captured(): Piece | null {
    return this.capturedPiece;
  }

  execute(board: Board): void {
    if (this.executed) throw new RangeError(`${this.describe()} has already been played`);
    this.capturedPiece = board.pieceAt(this.to);
    board.place(this.to, this.arriving());
    board.place(this.from, null);
    this.executed = true;
  }

  undo(board: Board): void {
    if (!this.executed) throw new RangeError(`${this.describe()} has not been played`);
    board.place(this.from, this.piece);
    board.place(this.to, this.capturedPiece);
    this.executed = false;
  }

  describe(): string {
    return `${this.piece.notationPrefix}${this.from}${this.capturedPiece ? 'x' : '-'}${this.to}`;
  }

  /** The piece that ends up on `to`; promotion overrides this. */
  protected arriving(): Piece {
    return this.piece;
  }
}

const PROMOTABLE = new Set([PieceType.QUEEN, PieceType.ROOK, PieceType.BISHOP, PieceType.KNIGHT]);

/** A pawn reaching the last rank is replaced; undo puts the pawn back. */
export class PromotionMove extends StandardMove {
  private readonly promoted: Piece;

  constructor(piece: Piece, from: Position, to: Position, promoteTo: PieceType = PieceType.QUEEN) {
    super(piece, from, to);
    if (!PROMOTABLE.has(promoteTo)) throw new InvalidPromotionError(promoteTo);
    this.promoted = createPiece(promoteTo, piece.color);
  }

  override describe(): string {
    return `${super.describe()}=${this.promoted.notationPrefix}`;
  }

  protected override arriving(): Piece {
    return this.promoted;
  }
}
