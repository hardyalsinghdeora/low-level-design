import { DomainError } from '../shared/errors';

export class SnakeAndLadderError extends DomainError {}

export class InvalidJumpError extends SnakeAndLadderError {
  constructor(jump: string, reason: string) {
    super(`Invalid ${jump}: ${reason}`);
  }
}

export class OverlappingJumpError extends SnakeAndLadderError {
  constructor(cell: number) {
    super(`Cell ${cell} already starts a snake or a ladder`);
  }
}

export class ChainedJumpError extends SnakeAndLadderError {
  constructor(cell: number) {
    super(`Cell ${cell} would chain two jumps: one ends where another starts`);
  }
}

export class NotEnoughPlayersError extends SnakeAndLadderError {
  constructor(count: number) {
    super(`At least 2 players are needed to start, got ${count}`);
  }
}

export class GameAlreadyStartedError extends SnakeAndLadderError {
  constructor() {
    super('The game has already started; players and setup are locked');
  }
}

export class GameNotStartedError extends SnakeAndLadderError {
  constructor() {
    super('The game has not started yet; call start() first');
  }
}

export class GameFinishedError extends SnakeAndLadderError {
  constructor(winnerName: string) {
    super(`The game is finished; ${winnerName} already won`);
  }
}
