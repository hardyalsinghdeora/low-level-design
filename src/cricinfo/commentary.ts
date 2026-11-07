import { type Ball, BallType } from './ball';
import type { Innings } from './innings';
import type { MatchResult } from './match';
import type { Over } from './over';

export type MatchEvent =
  | { kind: 'BALL'; ball: Ball; innings: Innings; at: Date }
  | { kind: 'OVER_COMPLETED'; over: Over; innings: Innings }
  | { kind: 'INNINGS_COMPLETED'; innings: Innings }
  | { kind: 'MATCH_COMPLETED'; result: MatchResult };

/** Observer: commentary, live scoreboards and push notifications all subscribe to the same events. */
export interface MatchObserver {
  onEvent(event: MatchEvent): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeRuns(ball: Ball): string {
  switch (ball.type) {
    case BallType.WIDE:
      return ball.runs ? `wide, ${plural(ball.runs, 'run')}` : 'wide';
    case BallType.NO_BALL:
      return ball.runs ? `no ball, ${plural(ball.runs, 'run')}` : 'no ball';
    case BallType.BYE:
      return plural(ball.runs, 'bye');
    case BallType.LEG_BYE:
      return plural(ball.runs, 'leg bye');
    case BallType.NORMAL:
      if (ball.runs === 4) return 'FOUR';
      if (ball.runs === 6) return 'SIX';
      return ball.runs === 0 ? 'no run' : plural(ball.runs, 'run');
  }
}

/** Ball-by-ball text commentary in the familiar "0.1 Bowler to Batter, FOUR" style. */
export class TextCommentary implements MatchObserver {
  readonly lines: string[] = [];

  onEvent(event: MatchEvent): void {
    switch (event.kind) {
      case 'BALL': {
        const { ball, innings } = event;
        const head = `${ball.overIndex}.${ball.ballNumber} ${innings.nameOf(ball.bowlerId)} to ${innings.nameOf(ball.strikerId)}`;
        if (!ball.wicket) {
          this.lines.push(`${head}, ${describeRuns(ball)}`);
          break;
        }
        const outId = ball.wicket.playerOutId ?? ball.strikerId;
        const how = innings.battingFigures().find((f) => f.playerId === outId)?.dismissal ?? '';
        const scored = ball.totalRuns > 0 ? ` (${describeRuns(ball)})` : '';
        this.lines.push(`${head}, OUT! ${innings.nameOf(outId)} ${how}${scored}`);
        break;
      }
      case 'OVER_COMPLETED': {
        const { over, innings } = event;
        const score = `${innings.battingTeam.name} ${innings.runs}/${innings.wickets}`;
        this.lines.push(`End of over ${over.index + 1}: ${plural(over.runsConceded, 'run')}${over.isMaiden ? ' (maiden)' : ''}, ${score}`);
        break;
      }
      case 'INNINGS_COMPLETED': {
        const { innings } = event;
        this.lines.push(`${innings.battingTeam.name} finish on ${innings.runs}/${innings.wickets} (${innings.endReason})`);
        break;
      }
      case 'MATCH_COMPLETED':
        this.lines.push(event.result.summary);
        break;
    }
  }
}
