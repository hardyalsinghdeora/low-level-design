import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Ball, Delivery } from './ball';
import type { MatchEvent, MatchObserver } from './commentary';
import { InvalidMatchTransitionError, MatchNotLiveError, NotFoundError } from './errors';
import { Innings } from './innings';
import type { Over } from './over';
import { buildScorecard, type Scorecard } from './scorecard';
import type { Team } from './team';

export enum MatchStatus {
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  COMPLETED = 'COMPLETED',
}

const TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  [MatchStatus.SCHEDULED]: [MatchStatus.LIVE],
  [MatchStatus.LIVE]: [MatchStatus.COMPLETED],
  [MatchStatus.COMPLETED]: [],
};

export interface MatchResult {
  /** `null` for a tie. */
  winnerId: string | null;
  summary: string;
}

export interface MatchOptions {
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root for a limited-overs match between two teams: the status
 * machine, the two innings, the target hand-over and the result. Every
 * delivery goes through `bowl()`, which publishes events to observers.
 */
export class Match {
  readonly id: string;
  private _status = MatchStatus.SCHEDULED;
  private readonly innings: Innings[] = [];
  private readonly observers = new Set<MatchObserver>();
  private _result: MatchResult | null = null;
  private readonly clock: Clock;

  constructor(
    readonly teamA: Team,
    readonly teamB: Team,
    readonly oversLimit: number,
    options: MatchOptions = {},
  ) {
    if (teamA.id === teamB.id) throw new RangeError('a team cannot play itself');
    if (!Number.isInteger(oversLimit) || oversLimit < 1) throw new RangeError('overs limit must be a positive integer');
    this.clock = options.clock ?? new SystemClock();
    this.id = (options.ids ?? new UuidGenerator()).next('MATCH');
  }

  get status(): MatchStatus {
    return this._status;
  }

  get result(): MatchResult | null {
    return this._result;
  }

  get currentInnings(): Innings | null {
    return this.innings[this.innings.length - 1] ?? null;
  }

  subscribe(observer: MatchObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  start(battingFirstId: string): Innings {
    const [batting, bowling] = this.sides(battingFirstId);
    this.transition(MatchStatus.LIVE);
    const first = new Innings(1, batting, bowling, this.oversLimit);
    this.innings.push(first);
    return first;
  }

  startOver(bowlerId: string): Over {
    return this.live().startOver(bowlerId);
  }

  bowl(delivery: Delivery): Ball {
    const innings = this.live();
    const ball = innings.bowl(delivery);
    this.emit({ kind: 'BALL', ball, innings, at: this.clock.now() });
    const over = innings.currentOver!;
    if (over.isComplete) this.emit({ kind: 'OVER_COMPLETED', over, innings });
    if (innings.isComplete) this.closeInnings(innings);
    return ball;
  }

  scorecards(): Scorecard[] {
    return this.innings.map(buildScorecard);
  }

  private closeInnings(innings: Innings): void {
    this.emit({ kind: 'INNINGS_COMPLETED', innings });
    if (innings.number === 1) {
      this.innings.push(new Innings(2, innings.bowlingTeam, innings.battingTeam, this.oversLimit, innings.runs + 1));
      return;
    }
    this._result = this.decide(innings);
    this.transition(MatchStatus.COMPLETED);
    this.emit({ kind: 'MATCH_COMPLETED', result: this._result });
  }

  private decide(chase: Innings): MatchResult {
    const target = chase.target!;
    if (chase.runs >= target) {
      const inHand = chase.battingTeam.players.length - 1 - chase.wickets;
      return { winnerId: chase.battingTeam.id, summary: `${chase.battingTeam.name} won by ${inHand} wicket${inHand === 1 ? '' : 's'}` };
    }
    if (chase.runs === target - 1) return { winnerId: null, summary: 'Match tied' };
    const margin = target - 1 - chase.runs;
    return { winnerId: chase.bowlingTeam.id, summary: `${chase.bowlingTeam.name} won by ${margin} run${margin === 1 ? '' : 's'}` };
  }

  private sides(battingFirstId: string): [Team, Team] {
    if (battingFirstId === this.teamA.id) return [this.teamA, this.teamB];
    if (battingFirstId === this.teamB.id) return [this.teamB, this.teamA];
    throw new NotFoundError('team in this match', battingFirstId);
  }

  private live(): Innings {
    if (this._status !== MatchStatus.LIVE) throw new MatchNotLiveError(this._status);
    return this.currentInnings!;
  }

  private emit(event: MatchEvent): void {
    for (const observer of this.observers) observer.onEvent(event);
  }

  private transition(next: MatchStatus): void {
    if (!TRANSITIONS[this._status].includes(next)) throw new InvalidMatchTransitionError(this._status, next);
    this._status = next;
  }
}
