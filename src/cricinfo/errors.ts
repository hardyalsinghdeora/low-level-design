import { DomainError } from '../shared/errors';
import type { MatchStatus } from './match';

export class CricketError extends DomainError {}

export class NotFoundError extends CricketError {
  constructor(kind: string, id: string) {
    super(`No ${kind} ${id}`);
  }
}

export class InvalidMatchTransitionError extends CricketError {
  constructor(from: MatchStatus, to: MatchStatus) {
    super(`Match cannot move from ${from} to ${to}`);
  }
}

export class MatchNotLiveError extends CricketError {
  constructor(status: MatchStatus) {
    super(`Match is ${status}; deliveries can only be recorded while LIVE`);
  }
}

export class InningsCompletedError extends CricketError {
  constructor(inningsNumber: number) {
    super(`Innings ${inningsNumber} is already complete`);
  }
}

export class NoActiveOverError extends CricketError {
  constructor() {
    super('No over in progress: start a new over with a bowler first');
  }
}

export class OverInProgressError extends CricketError {
  constructor(legalBalls: number) {
    super(`The current over has only ${legalBalls} legal deliveries; finish it first`);
  }
}

export class ConsecutiveOversError extends CricketError {
  constructor(bowlerId: string) {
    super(`${bowlerId} bowled the previous over and cannot bowl two in a row`);
  }
}

export class InvalidDeliveryError extends CricketError {}
