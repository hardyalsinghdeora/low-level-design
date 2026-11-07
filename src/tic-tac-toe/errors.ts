import { DomainError } from '../shared/errors';

export class TicTacToeError extends DomainError {}

export class OutOfBoundsError extends TicTacToeError {
  constructor(row: number, col: number, size: number) {
    super(`Cell (${row}, ${col}) is outside the ${size}x${size} board`);
  }
}

export class CellOccupiedError extends TicTacToeError {
  constructor(row: number, col: number, symbol: string) {
    super(`Cell (${row}, ${col}) is already taken by ${symbol}`);
  }
}

export class NotYourTurnError extends TicTacToeError {
  constructor(playerName: string, expectedName: string) {
    super(`It is ${expectedName}'s turn, not ${playerName}'s`);
  }
}

export class GameOverError extends TicTacToeError {
  constructor(status: string) {
    super(`The game is over (${status}); no more moves are accepted`);
  }
}

export class NothingToUndoError extends TicTacToeError {
  constructor() {
    super('There is no move to undo');
  }
}

export class NoMoveProvidedError extends TicTacToeError {
  constructor(playerName: string) {
    super(`${playerName} has not chosen a cell yet`);
  }
}
