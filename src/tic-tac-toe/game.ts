import { Board, type Position } from './board';
import { GameOverError, NothingToUndoError, NotYourTurnError } from './errors';
import { LineCounters, type LineCounts, type WinningLine } from './line-counters';
import type { Player, PlayerSymbol } from './player';

/**
 * IN_PROGRESS -> WON | DRAW happens only through a move; WON | DRAW ->
 * IN_PROGRESS happens only through undo. Nothing else changes the status.
 */
export enum GameStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  WON = 'WON',
  DRAW = 'DRAW',
}

export interface Move {
  readonly number: number;
  readonly player: Player;
  readonly position: Position;
}

export interface MoveOutcome {
  move: Move;
  status: GameStatus;
  winner: Player | null;
  winningLine?: WinningLine;
}

export interface GameOptions {
  /** Side length of the board. A win always needs a full row, column or diagonal. */
  size?: number;
}

/**
 * Aggregate root. Owns turn order, the status machine and the move history.
 * Board and LineCounters only know cells and counts, so every rule that spans
 * them (whose turn it is, whether the game is over, what undo restores) lives
 * here.
 */
export class Game {
  readonly board: Board;
  private readonly counters: LineCounters;
  private readonly players: readonly [Player, Player];
  private readonly history: Move[] = [];
  private _status = GameStatus.IN_PROGRESS;
  private _winner: Player | null = null;
  private _winningLine: WinningLine | undefined;

  /** `first` moves first. */
  constructor(first: Player, second: Player, options: GameOptions = {}) {
    if (first.symbol === second.symbol) {
      throw new RangeError(`Players need different symbols, both use ${first.symbol}`);
    }
    this.players = [first, second];
    this.board = new Board(options.size ?? 3);
    this.counters = new LineCounters(this.board.size);
  }

  get status(): GameStatus {
    return this._status;
  }

  get winner(): Player | null {
    return this._winner;
  }

  get winningLine(): WinningLine | undefined {
    return this._winningLine;
  }

  /** Turns alternate strictly, so the history length decides who is next. */
  get currentPlayer(): Player {
    return this.players[this.history.length % 2];
  }

  get moves(): readonly Move[] {
    return [...this.history];
  }

  lineCounts(symbol: PlayerSymbol): LineCounts {
    return this.counters.snapshot(symbol);
  }

  /**
   * An explicit move, e.g. from a click. Checks run cheapest-first (game
   * over, turn, then the cell) and nothing is mutated until all have passed.
   */
  makeMove(player: Player, row: number, col: number): MoveOutcome {
    this.assertInProgress();
    const expected = this.currentPlayer;
    if (player !== expected) throw new NotYourTurnError(player.name, expected.name);

    const position: Position = { row, col };
    this.board.place(position, player.symbol);
    const move: Move = { number: this.history.length + 1, player, position };
    this.history.push(move);

    const line = this.counters.record(position, player.symbol);
    if (line) {
      this._status = GameStatus.WON;
      this._winner = player;
      this._winningLine = line;
    } else if (this.board.isFull) {
      this._status = GameStatus.DRAW;
    }
    return { move, status: this._status, winner: this._winner, winningLine: this._winningLine };
  }

  /** Lets the current player's strategy pick the cell: a bot plays itself, a human's queued choice is used. */
  playTurn(): MoveOutcome {
    this.assertInProgress();
    const player = this.currentPlayer;
    const { row, col } = player.strategy.chooseMove(this.board, player);
    return this.makeMove(player, row, col);
  }

  /** Takes back the last move, even a winning one, and reopens a finished game. */
  undo(): Move {
    const move = this.history.pop();
    if (!move) throw new NothingToUndoError();
    this.board.clear(move.position);
    this.counters.revert(move.position, move.player.symbol);
    this._status = GameStatus.IN_PROGRESS;
    this._winner = null;
    this._winningLine = undefined;
    return move;
  }

  private assertInProgress(): void {
    if (this._status !== GameStatus.IN_PROGRESS) throw new GameOverError(this._status);
  }
}
