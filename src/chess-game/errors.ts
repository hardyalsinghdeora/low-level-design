import { DomainError } from '../shared/errors';

export class ChessError extends DomainError {}

export class InvalidSquareError extends ChessError {
  constructor(square: string) {
    super(`"${square}" is not a square; use a file a-h and a rank 1-8, e.g. "e4"`);
  }
}

export class EmptySquareError extends ChessError {
  constructor(square: string) {
    super(`There is no piece on ${square}`);
  }
}

export class NotYourTurnError extends ChessError {
  constructor(turn: string) {
    super(`It is ${turn}'s turn`);
  }
}

export class IllegalMoveError extends ChessError {
  constructor(piece: string, from: string, to: string) {
    super(`The ${piece} on ${from} cannot move to ${to}`);
  }
}

export class MoveLeavesKingInCheckError extends ChessError {
  constructor(from: string, to: string) {
    super(`${from}-${to} would leave your own king in check`);
  }
}

export class GameOverError extends ChessError {
  constructor(status: string) {
    super(`The game is over (${status}); no more moves are accepted`);
  }
}

export class NothingToUndoError extends ChessError {
  constructor() {
    super('There is no move to undo');
  }
}

export class InvalidFenError extends ChessError {
  constructor(fen: string, reason: string) {
    super(`Cannot read position "${fen}": ${reason}`);
  }
}

export class InvalidPromotionError extends ChessError {
  constructor(type: string) {
    super(`A pawn cannot promote to a ${type.toLowerCase()}; choose a queen, rook, bishop or knight`);
  }
}
