import { Ball, BallType, describeDismissal, type Delivery } from './ball';
import {
  ConsecutiveOversError,
  InningsCompletedError,
  InvalidDeliveryError,
  NoActiveOverError,
  OverInProgressError,
} from './errors';
import { BALLS_PER_OVER, Over } from './over';
import type { Team } from './team';

export enum InningsEndReason {
  ALL_OUT = 'ALL_OUT',
  OVERS_COMPLETED = 'OVERS_COMPLETED',
  TARGET_REACHED = 'TARGET_REACHED',
}

export interface BattingFigures {
  playerId: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  /** `null` while not out. */
  dismissal: string | null;
}

export interface BowlingFigures {
  playerId: string;
  legalBalls: number;
  runsConceded: number;
  wickets: number;
  maidens: number;
  wides: number;
  noBalls: number;
}

export interface Extras {
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
}

/**
 * One side's batting. Owns the crease (striker, non-striker, next batter),
 * the overs, and running batting and bowling figures, and decides when the
 * innings is over: all out, overs exhausted, or target reached.
 */
export class Innings {
  private readonly overs: Over[] = [];
  private readonly batting = new Map<string, BattingFigures>();
  private readonly bowling = new Map<string, BowlingFigures>();
  private readonly _extras: Extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
  private _striker: string;
  private _nonStriker: string;
  private nextBatter = 2;
  private _runs = 0;
  private _wickets = 0;
  private _endReason: InningsEndReason | null = null;

  constructor(
    readonly number: number,
    readonly battingTeam: Team,
    readonly bowlingTeam: Team,
    readonly maxOvers: number,
    /** Runs needed to win; only the second innings has one. */
    readonly target: number | null = null,
  ) {
    const [first, second] = battingTeam.players;
    this._striker = this.walkIn(first.id);
    this._nonStriker = this.walkIn(second.id);
  }

  get runs(): number {
    return this._runs;
  }

  get wickets(): number {
    return this._wickets;
  }

  get striker(): string {
    return this._striker;
  }

  get nonStriker(): string {
    return this._nonStriker;
  }

  get extras(): Extras {
    return { ...this._extras };
  }

  get legalBalls(): number {
    return this.overs.reduce((sum, over) => sum + over.legalBalls, 0);
  }

  get ballsRemaining(): number {
    return this.maxOvers * BALLS_PER_OVER - this.legalBalls;
  }

  get isComplete(): boolean {
    return this._endReason !== null;
  }

  get endReason(): InningsEndReason | null {
    return this._endReason;
  }

  get currentOver(): Over | null {
    return this.overs[this.overs.length - 1] ?? null;
  }

  battingFigures(): BattingFigures[] {
    return [...this.batting.values()].map((figures) => ({ ...figures }));
  }

  bowlingFigures(): BowlingFigures[] {
    return [...this.bowling.values()].map((figures) => ({ ...figures }));
  }

  nameOf(playerId: string): string {
    return (this.battingTeam.has(playerId) ? this.battingTeam : this.bowlingTeam).player(playerId).name;
  }

  startOver(bowlerId: string): Over {
    this.requireInProgress();
    this.bowlingTeam.player(bowlerId);
    const previous = this.currentOver;
    if (previous && !previous.isComplete) throw new OverInProgressError(previous.legalBalls);
    if (previous && previous.bowlerId === bowlerId) throw new ConsecutiveOversError(bowlerId);
    const over = new Over(this.overs.length, bowlerId);
    this.overs.push(over);
    if (!this.bowling.has(bowlerId)) {
      this.bowling.set(bowlerId, { playerId: bowlerId, legalBalls: 0, runsConceded: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0 });
    }
    return over;
  }

  bowl(delivery: Delivery): Ball {
    this.requireInProgress();
    const over = this.currentOver;
    if (!over || over.isComplete) throw new NoActiveOverError();
    const ball = new Ball(over.index, over.legalBalls + 1, over.bowlerId, this._striker, delivery);
    const outId = ball.wicket ? (ball.wicket.playerOutId ?? this._striker) : null;
    if (outId !== null && outId !== this._striker && outId !== this._nonStriker) {
      throw new InvalidDeliveryError(`${outId} is not at the crease`);
    }
    over.add(ball);
    this.account(ball);
    if (ball.rotatesStrike) this.swapEnds();
    if (ball.wicket && outId !== null) this.dismiss(outId, ball);
    this.checkEnd(over);
    return ball;
  }

  private account(ball: Ball): void {
    this._runs += ball.totalRuns;
    const batter = this.batting.get(this._striker)!;
    batter.runs += ball.batterRuns;
    if (ball.countsAsBallFaced) batter.balls += 1;
    if (ball.batterRuns === 4) batter.fours += 1;
    if (ball.batterRuns === 6) batter.sixes += 1;

    const bowler = this.bowling.get(ball.bowlerId)!;
    bowler.runsConceded += ball.runsConceded;
    if (ball.isLegal) bowler.legalBalls += 1;
    if (ball.isBowlerWicket) bowler.wickets += 1;

    switch (ball.type) {
      case BallType.WIDE:
        bowler.wides += 1;
        this._extras.wides += ball.extras;
        break;
      case BallType.NO_BALL:
        bowler.noBalls += 1;
        this._extras.noBalls += ball.extras;
        break;
      case BallType.BYE:
        this._extras.byes += ball.extras;
        break;
      case BallType.LEG_BYE:
        this._extras.legByes += ball.extras;
        break;
      case BallType.NORMAL:
        break;
    }
  }

  /** The new batter walks in at the end the dismissed batter left (after any runs were completed). */
  private dismiss(outId: string, ball: Ball): void {
    this._wickets += 1;
    const wicket = ball.wicket!;
    const fielder = wicket.fielderId ? this.bowlingTeam.player(wicket.fielderId).name : undefined;
    this.batting.get(outId)!.dismissal = describeDismissal(wicket, this.nameOf(ball.bowlerId), fielder);
    if (this.nextBatter >= this.battingTeam.players.length) return; // all out; checkEnd closes the innings
    const incoming = this.walkIn(this.battingTeam.players[this.nextBatter].id);
    this.nextBatter += 1;
    if (outId === this._striker) this._striker = incoming;
    else this._nonStriker = incoming;
  }

  private checkEnd(over: Over): void {
    if (over.isMaiden) this.bowling.get(over.bowlerId)!.maidens += 1;
    if (this.target !== null && this._runs >= this.target) {
      this._endReason = InningsEndReason.TARGET_REACHED;
    } else if (this._wickets >= this.battingTeam.players.length - 1) {
      this._endReason = InningsEndReason.ALL_OUT;
    } else if (over.isComplete) {
      if (this.overs.length >= this.maxOvers) this._endReason = InningsEndReason.OVERS_COMPLETED;
      else this.swapEnds(); // batters change ends between overs
    }
  }

  private walkIn(playerId: string): string {
    this.batting.set(playerId, { playerId, runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null });
    return playerId;
  }

  private swapEnds(): void {
    [this._striker, this._nonStriker] = [this._nonStriker, this._striker];
  }

  private requireInProgress(): void {
    if (this.isComplete) throw new InningsCompletedError(this.number);
  }
}
