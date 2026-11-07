import { type Clock, SystemClock } from '../shared/clock';
import { type IdGenerator, UuidGenerator } from '../shared/id-generator';
import { Board } from './board';
import {
  EmptySquareError,
  GameOverError,
  IllegalMoveError,
  InvalidFenError,
  MoveLeavesKingInCheckError,
  NothingToUndoError,
  NotYourTurnError,
} from './errors';
import { assertTransition, GameStatus, isTerminal } from './game-status';
import { type MoveCommand, PromotionMove, StandardMove } from './move';
import { Color, opposite, type Piece, PieceType } from './pieces/piece';
import { Position } from './position';

export interface MoveRecord {
  readonly ply: number;
  readonly color: Color;
  readonly notation: string;
  readonly playedAt: Date;
  readonly statusAfter: GameStatus;
}

export interface GameOptions {
  board?: Board;
  turn?: Color;
  clock?: Clock;
  ids?: IdGenerator;
}

interface HistoryEntry {
  readonly command: MoveCommand;
  readonly record: MoveRecord;
  readonly statusBefore: GameStatus;
}

const SUFFIX: Record<GameStatus, string> = {
  [GameStatus.ACTIVE]: '',
  [GameStatus.STALEMATE]: '',
  [GameStatus.CHECK]: '+',
  [GameStatus.CHECKMATE]: '#',
};

/**
 * Aggregate root and referee. Pieces propose pseudo-legal squares; Game
 * enforces turn order, rejects moves that leave the mover in check, and
 * classifies the position after every move. It is the only writer of the board.
 */
export class Game {
  readonly id: string;
  private readonly board: Board;
  private readonly clock: Clock;
  private readonly history: HistoryEntry[] = [];
  private turnColor: Color;
  private currentStatus: GameStatus;

  constructor(options: GameOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.id = (options.ids ?? new UuidGenerator()).next('GAME');
    this.board = options.board ?? Board.standard();
    this.turnColor = options.turn ?? Color.WHITE;
    this.currentStatus = this.evaluate();
  }

  /** "placement [w|b]", the first two FEN fields; castling and en passant fields are ignored. */
  static fromFen(fen: string, options: Omit<GameOptions, 'board' | 'turn'> = {}): Game {
    const [placement = '', active = 'w'] = fen.trim().split(/\s+/);
    if (active !== 'w' && active !== 'b') throw new InvalidFenError(fen, 'side to move must be "w" or "b"');
    return new Game({ ...options, board: Board.fromFen(placement), turn: active === 'w' ? Color.WHITE : Color.BLACK });
  }

  get turn(): Color {
    return this.turnColor;
  }

  get status(): GameStatus {
    return this.currentStatus;
  }

  get winner(): Color | undefined {
    return this.currentStatus === GameStatus.CHECKMATE ? opposite(this.turnColor) : undefined;
  }

  get moves(): readonly MoveRecord[] {
    return this.history.map((entry) => entry.record);
  }

  get fen(): string {
    return `${this.board.toFen()} ${this.turnColor === Color.WHITE ? 'w' : 'b'}`;
  }

  pieceAt(square: string): Piece | null {
    return this.board.pieceAt(Position.parse(square));
  }

  render(): string {
    return this.board.toAscii();
  }

  /** Plays "e2" to "e4". A pawn reaching the last rank promotes to `promotion` (queen by default). */
  move(from: string, to: string, promotion: PieceType = PieceType.QUEEN): MoveRecord {
    if (isTerminal(this.currentStatus)) throw new GameOverError(this.currentStatus);
    const origin = Position.parse(from);
    const target = Position.parse(to);
    const piece = this.board.pieceAt(origin);
    if (!piece) throw new EmptySquareError(origin.toString());
    if (piece.color !== this.turnColor) throw new NotYourTurnError(this.turnColor);
    if (!piece.pseudoLegalMoves(this.board, origin).some((square) => square.equals(target))) {
      throw new IllegalMoveError(piece.type.toLowerCase(), origin.toString(), target.toString());
    }

    const command = this.createCommand(piece, origin, target, promotion);
    command.execute(this.board);
    if (this.board.isInCheck(piece.color)) {
      command.undo(this.board);
      throw new MoveLeavesKingInCheckError(origin.toString(), target.toString());
    }

    const statusBefore = this.currentStatus;
    this.turnColor = opposite(this.turnColor);
    const next = this.evaluate();
    assertTransition(statusBefore, next);
    this.currentStatus = next;

    const record: MoveRecord = {
      ply: this.history.length + 1,
      color: piece.color,
      notation: command.describe() + SUFFIX[next],
      playedAt: this.clock.now(),
      statusAfter: next,
    };
    this.history.push({ command, record, statusBefore });
    return record;
  }

  /** Takes back the last move. Undo is a rewind, so it may leave CHECKMATE or STALEMATE. */
  undo(): MoveRecord {
    const entry = this.history.pop();
    if (!entry) throw new NothingToUndoError();
    entry.command.undo(this.board);
    this.turnColor = opposite(this.turnColor);
    this.currentStatus = entry.statusBefore;
    return entry.record;
  }

  /** Fully legal destinations for the piece on `square`, sorted, for UIs and hints. */
  legalMoves(square: string): string[] {
    const origin = Position.parse(square);
    const piece = this.board.pieceAt(origin);
    if (!piece) throw new EmptySquareError(origin.toString());
    return piece
      .pseudoLegalMoves(this.board, origin)
      .filter((target) => this.isLegal(this.createCommand(piece, origin, target), piece.color))
      .map((target) => target.toString())
      .sort();
  }

  private createCommand(piece: Piece, from: Position, to: Position, promotion = PieceType.QUEEN): MoveCommand {
    return piece.promotesOn(to) ? new PromotionMove(piece, from, to, promotion) : new StandardMove(piece, from, to);
  }

  /** Try the move, look at the king, take it back: the Command makes this cheap and exact. */
  private isLegal(command: MoveCommand, color: Color): boolean {
    command.execute(this.board);
    const safe = !this.board.isInCheck(color);
    command.undo(this.board);
    return safe;
  }

  private hasAnyLegalMove(color: Color): boolean {
    return this.board
      .pieces(color)
      .some(({ piece, position }) =>
        piece
          .pseudoLegalMoves(this.board, position)
          .some((target) => this.isLegal(this.createCommand(piece, position, target), color)),
      );
  }

  /** Classifies the position for the side to move. */
  private evaluate(): GameStatus {
    const inCheck = this.board.isInCheck(this.turnColor);
    const canMove = this.hasAnyLegalMove(this.turnColor);
    if (inCheck) return canMove ? GameStatus.CHECK : GameStatus.CHECKMATE;
    return canMove ? GameStatus.ACTIVE : GameStatus.STALEMATE;
  }
}
