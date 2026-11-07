import { InvalidDeliveryError } from './errors';

export enum BallType {
  NORMAL = 'NORMAL',
  WIDE = 'WIDE',
  NO_BALL = 'NO_BALL',
  BYE = 'BYE',
  LEG_BYE = 'LEG_BYE',
}

export enum DismissalType {
  BOWLED = 'BOWLED',
  CAUGHT = 'CAUGHT',
  LBW = 'LBW',
  RUN_OUT = 'RUN_OUT',
  STUMPED = 'STUMPED',
  HIT_WICKET = 'HIT_WICKET',
}

export interface Wicket {
  type: DismissalType;
  /** Defaults to the striker; a run out may dismiss the non-striker. */
  playerOutId?: string;
  fielderId?: string;
}

/** What the scorer enters for one delivery. `runs` is what the batters ran or the boundary. */
export interface Delivery {
  type?: BallType;
  runs?: number;
  wicket?: Wicket;
}

/** Which dismissals the Laws allow off each kind of delivery. */
const ALLOWED_DISMISSALS: Record<BallType, readonly DismissalType[]> = {
  [BallType.NORMAL]: Object.values(DismissalType),
  [BallType.WIDE]: [DismissalType.RUN_OUT, DismissalType.STUMPED, DismissalType.HIT_WICKET],
  [BallType.NO_BALL]: [DismissalType.RUN_OUT],
  [BallType.BYE]: [DismissalType.RUN_OUT],
  [BallType.LEG_BYE]: [DismissalType.RUN_OUT],
};

const NOT_CREDITED_TO_BOWLER = new Set([DismissalType.RUN_OUT]);

/** One extra run is the penalty for a wide or a no-ball. */
export const PENALTY_RUNS = 1;

/**
 * A recorded delivery. All of cricket's accounting rules live here as
 * derived values (legal or not, who gets the runs, what the bowler
 * concedes), so the innings just adds them up.
 */
export class Ball {
  readonly type: BallType;
  readonly runs: number;
  readonly wicket: Wicket | null;

  constructor(
    readonly overIndex: number,
    /** Display ball number: an illegal delivery shares the number of the ball that replaces it. */
    readonly ballNumber: number,
    readonly bowlerId: string,
    readonly strikerId: string,
    delivery: Delivery,
  ) {
    this.type = delivery.type ?? BallType.NORMAL;
    this.runs = delivery.runs ?? 0;
    this.wicket = delivery.wicket ?? null;
    if (!Number.isInteger(this.runs) || this.runs < 0 || this.runs > 7) {
      throw new InvalidDeliveryError(`runs must be an integer from 0 to 7, got ${this.runs}`);
    }
    if (this.wicket && !ALLOWED_DISMISSALS[this.type].includes(this.wicket.type)) {
      throw new InvalidDeliveryError(`${this.wicket.type} is not possible off a ${this.type} delivery`);
    }
  }

  get isLegal(): boolean {
    return this.type !== BallType.WIDE && this.type !== BallType.NO_BALL;
  }

  /** Runs off the bat: normal deliveries and no-balls only. */
  get batterRuns(): number {
    return this.type === BallType.NORMAL || this.type === BallType.NO_BALL ? this.runs : 0;
  }

  get extras(): number {
    switch (this.type) {
      case BallType.NORMAL:
        return 0;
      case BallType.WIDE:
        return PENALTY_RUNS + this.runs;
      case BallType.NO_BALL:
        return PENALTY_RUNS;
      case BallType.BYE:
      case BallType.LEG_BYE:
        return this.runs;
    }
  }

  get totalRuns(): number {
    return this.batterRuns + this.extras;
  }

  /** Byes and leg byes are the keeper's or batter's fault, not the bowler's. */
  get runsConceded(): number {
    return this.type === BallType.BYE || this.type === BallType.LEG_BYE ? 0 : this.totalRuns;
  }

  /** A wide is not a ball faced; a no-ball is. */
  get countsAsBallFaced(): boolean {
    return this.type !== BallType.WIDE;
  }

  get isBowlerWicket(): boolean {
    return this.wicket !== null && !NOT_CREDITED_TO_BOWLER.has(this.wicket.type);
  }

  /** Strike changes when the batters cross an odd number of times. */
  get rotatesStrike(): boolean {
    return this.runs % 2 === 1;
  }
}

export function describeDismissal(wicket: Wicket, bowler: string, fielder?: string): string {
  switch (wicket.type) {
    case DismissalType.BOWLED:
      return `b ${bowler}`;
    case DismissalType.CAUGHT:
      return fielder ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`;
    case DismissalType.LBW:
      return `lbw b ${bowler}`;
    case DismissalType.STUMPED:
      return `st ${fielder ?? 'keeper'} b ${bowler}`;
    case DismissalType.HIT_WICKET:
      return `hit wicket b ${bowler}`;
    case DismissalType.RUN_OUT:
      return fielder ? `run out (${fielder})` : 'run out';
  }
}
