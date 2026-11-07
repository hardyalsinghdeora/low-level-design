import type { BattingFigures, BowlingFigures, Extras, Innings } from './innings';
import { BALLS_PER_OVER } from './over';

export interface BattingRow extends BattingFigures {
  name: string;
  strikeRate: number;
}

export interface BowlingRow extends BowlingFigures {
  name: string;
  overs: string;
  economy: number;
}

export interface Scorecard {
  team: string;
  score: string;
  overs: string;
  runRate: number;
  target: number | null;
  requiredRunRate: number | null;
  extras: Extras & { total: number };
  batting: BattingRow[];
  bowling: BowlingRow[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 20 legal balls -> "3.2" (three overs and two balls). */
export function oversNotation(legalBalls: number): string {
  return `${Math.floor(legalBalls / BALLS_PER_OVER)}.${legalBalls % BALLS_PER_OVER}`;
}

/** Runs per six legal balls, to two decimals. Rates are display values, not money, so floats are fine. */
export function runRate(runs: number, legalBalls: number): number {
  return legalBalls === 0 ? 0 : round2((runs * BALLS_PER_OVER) / legalBalls);
}

/** A read model built from the innings on demand; it never mutates the match. */
export function buildScorecard(innings: Innings): Scorecard {
  const extras = innings.extras;
  const needed = innings.target === null ? null : Math.max(0, innings.target - innings.runs);
  const live = !innings.isComplete && innings.ballsRemaining > 0;
  return {
    team: innings.battingTeam.name,
    score: `${innings.runs}/${innings.wickets}`,
    overs: oversNotation(innings.legalBalls),
    runRate: runRate(innings.runs, innings.legalBalls),
    target: innings.target,
    requiredRunRate: needed !== null && live ? runRate(needed, innings.ballsRemaining) : null,
    extras: { ...extras, total: extras.wides + extras.noBalls + extras.byes + extras.legByes },
    batting: innings.battingFigures().map((f) => ({
      ...f,
      name: innings.nameOf(f.playerId),
      strikeRate: f.balls === 0 ? 0 : round2((f.runs * 100) / f.balls),
    })),
    bowling: innings.bowlingFigures().map((f) => ({
      ...f,
      name: innings.nameOf(f.playerId),
      overs: oversNotation(f.legalBalls),
      economy: runRate(f.runsConceded, f.legalBalls),
    })),
  };
}
