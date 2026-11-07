import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  BallType,
  ConsecutiveOversError,
  type Delivery,
  DismissalType,
  InningsEndReason,
  InvalidDeliveryError,
  InvalidMatchTransitionError,
  Match,
  MatchNotLiveError,
  MatchStatus,
  NoActiveOverError,
  NotFoundError,
  OverInProgressError,
  Team,
  TextCommentary,
} from './index';

const squad = (prefix: string, names: string[]) => names.map((name, i) => ({ id: `${prefix}${i + 1}`, name }));

function newMatch() {
  const a = new Team('A', 'Mariners', squad('a', ['Arjun', 'Bala', 'Chetan', 'Dhruv']));
  const b = new Team('B', 'Chargers', squad('b', ['Kiran', 'Lalit', 'Manoj', 'Nikhil']));
  const match = new Match(a, b, 2, { clock: new FakeClock(), ids: new SequentialIdGenerator() });
  return match;
}

function started() {
  const match = newMatch();
  match.start('A');
  return { match, innings: match.currentInnings! };
}

function over(match: Match, bowlerId: string, deliveries: Delivery[]): void {
  match.startOver(bowlerId);
  for (const d of deliveries) match.bowl(d);
}

const runs = (...values: number[]): Delivery[] => values.map((r) => ({ runs: r }));

/** Mariners make 14/0 in two overs: target 15. */
function afterFirstInnings() {
  const { match } = started();
  over(match, 'b1', runs(4, 1, 0, 0, 2, 0));
  over(match, 'b2', runs(6, 0, 0, 0, 0, 1));
  return match;
}

describe('deliveries and strike', () => {
  it('credits runs to the striker, rotates on odd runs and swaps ends at the end of an over', () => {
    const { match, innings } = started();
    over(match, 'b1', runs(1, 0, 3, 0, 0, 0));
    const [a1, a2] = innings.battingFigures();
    expect([a1.runs, a1.balls, a2.runs, a2.balls]).toEqual([1, 4, 3, 2]);
    // Bala's 3 left him at the non-striker's end; the change of ends puts him back on strike
    expect([innings.striker, innings.nonStriker]).toEqual(['a2', 'a1']);
  });

  it('a wide adds one extra plus any runs taken, is not a legal ball and is not faced', () => {
    const { match, innings } = started();
    match.startOver('b1');
    match.bowl({ type: BallType.WIDE });
    match.bowl({ type: BallType.WIDE, runs: 1 });
    expect(innings.runs).toBe(3);
    expect(innings.extras.wides).toBe(3);
    expect(innings.legalBalls).toBe(0);
    expect(innings.battingFigures()[0].balls).toBe(0);
    expect(innings.bowlingFigures()[0]).toMatchObject({ runsConceded: 3, wides: 2, legalBalls: 0 });
    expect(innings.striker).toBe('a2'); // the single run on the second wide crossed them
  });

  it('a no-ball adds one extra, runs off the bat go to the batter and the ball counts as faced', () => {
    const { match, innings } = started();
    match.startOver('b1');
    match.bowl({ type: BallType.NO_BALL, runs: 4 });
    const [a1] = innings.battingFigures();
    expect([a1.runs, a1.balls, a1.fours]).toEqual([4, 1, 1]);
    expect(innings.runs).toBe(5);
    expect(innings.extras.noBalls).toBe(1);
    expect(innings.legalBalls).toBe(0);
    expect(innings.bowlingFigures()[0].runsConceded).toBe(5);
  });

  it('byes and leg byes are extras, legal, not charged to the bowler and still rotate strike', () => {
    const { match, innings } = started();
    match.startOver('b1');
    match.bowl({ type: BallType.BYE, runs: 1 });
    match.bowl({ type: BallType.LEG_BYE, runs: 2 });
    expect(innings.extras).toEqual({ wides: 0, noBalls: 0, byes: 1, legByes: 2 });
    expect(innings.legalBalls).toBe(2);
    expect(innings.bowlingFigures()[0].runsConceded).toBe(0);
    const [a1, a2] = innings.battingFigures();
    expect([a1.runs, a1.balls, a2.runs, a2.balls]).toEqual([0, 1, 0, 1]);
  });
});

describe('overs', () => {
  it('completes after six legal deliveries however many extras were bowled', () => {
    const { match, innings } = started();
    match.startOver('b1');
    expect(() => match.startOver('b2')).toThrow(OverInProgressError);
    for (const d of [{}, { type: BallType.WIDE }, {}, { type: BallType.NO_BALL }, {}, {}, {}, {}]) match.bowl(d);
    expect(innings.currentOver?.balls).toHaveLength(8);
    expect(innings.currentOver?.isComplete).toBe(true);
    expect(() => match.bowl({})).toThrow(NoActiveOverError);
  });

  it('forbids consecutive overs by one bowler and bowlers from the batting side', () => {
    const { match } = started();
    over(match, 'b1', runs(0, 0, 0, 0, 0, 0));
    expect(() => match.startOver('b1')).toThrow(ConsecutiveOversError);
    expect(() => match.startOver('a1')).toThrow(NotFoundError);
    expect(match.currentInnings?.bowlingFigures()[0].maidens).toBe(1);
  });
});

describe('wickets and innings end', () => {
  it('credits the bowler for bowled but not run out, replaces the dismissed batter and validates dismissals', () => {
    const { match, innings } = started();
    match.startOver('b1');
    expect(() => match.bowl({ type: BallType.NO_BALL, wicket: { type: DismissalType.BOWLED } })).toThrow(InvalidDeliveryError);
    match.bowl({ wicket: { type: DismissalType.BOWLED } });
    expect(innings.striker).toBe('a3');
    match.bowl({ runs: 1 }); // a3 to the other end
    match.bowl({ wicket: { type: DismissalType.RUN_OUT, playerOutId: 'a3', fielderId: 'b4' } });
    expect([innings.striker, innings.nonStriker]).toEqual(['a2', 'a4']);
    expect(innings.wickets).toBe(2);
    expect(innings.bowlingFigures()[0].wickets).toBe(1);
    expect(innings.battingFigures().map((f) => f.dismissal)).toEqual(['b Kiran', null, 'run out (Nikhil)', null]);
  });

  it('ends the innings when all out and sets the target for the second innings', () => {
    const { match, innings } = started();
    match.startOver('b1');
    match.bowl({ runs: 2 });
    for (let i = 0; i < 3; i += 1) match.bowl({ wicket: { type: DismissalType.LBW } });
    expect(innings.endReason).toBe(InningsEndReason.ALL_OUT);
    expect(match.currentInnings?.number).toBe(2);
    expect(match.currentInnings?.target).toBe(3);
  });

  it('ends the first innings when the overs run out', () => {
    const match = afterFirstInnings();
    const [first, second] = match.scorecards();
    expect(first).toMatchObject({ score: '14/0', overs: '2.0', runRate: 7 });
    expect(second.target).toBe(15);
  });

  it('ends the match the moment the target is chased, mid-over', () => {
    const match = afterFirstInnings();
    match.startOver('a1');
    for (const d of runs(6, 6, 2, 1)) match.bowl(d);
    expect(match.status).toBe(MatchStatus.COMPLETED);
    expect(match.currentInnings?.endReason).toBe(InningsEndReason.TARGET_REACHED);
    expect(match.result).toEqual({ winnerId: 'B', summary: 'Chargers won by 3 wickets' });
    expect(() => match.bowl({})).toThrow(MatchNotLiveError);
  });

  it('declares a win by runs when the chase falls short, and a tie when scores level', () => {
    const short = afterFirstInnings();
    over(short, 'a1', runs(0, 0, 0, 0, 0, 0));
    over(short, 'a2', runs(1, 1, 1, 1, 1, 1));
    expect(short.result).toEqual({ winnerId: 'A', summary: 'Mariners won by 8 runs' });

    const tied = afterFirstInnings();
    over(tied, 'a1', runs(6, 6, 0, 0, 0, 0));
    over(tied, 'a2', runs(1, 1, 0, 0, 0, 0));
    expect(tied.result).toEqual({ winnerId: null, summary: 'Match tied' });
  });
});

describe('match, scorecard and commentary', () => {
  it('validates match states', () => {
    const match = newMatch();
    expect(() => match.startOver('b1')).toThrow(MatchNotLiveError);
    match.start('A');
    expect(() => match.start('B')).toThrow(InvalidMatchTransitionError);
  });

  it('builds a scorecard with extras, strike rates, bowling figures and the required run rate', () => {
    const { match } = started();
    match.startOver('b1');
    const deliveries: Delivery[] = [
      { type: BallType.WIDE },
      { type: BallType.NO_BALL, runs: 2 },
      { type: BallType.BYE, runs: 1 },
      { type: BallType.LEG_BYE, runs: 2 },
      {},
      {},
      {},
      { runs: 4 },
    ];
    for (const d of deliveries) match.bowl(d);
    const [card] = match.scorecards();
    expect(card).toMatchObject({ score: '11/0', overs: '1.0', runRate: 11, requiredRunRate: null });
    expect(card.extras).toEqual({ wides: 1, noBalls: 1, byes: 1, legByes: 2, total: 5 });
    expect(card.batting.map((b) => [b.name, b.runs, b.balls, b.strikeRate])).toEqual([
      ['Arjun', 2, 2, 100],
      ['Bala', 4, 5, 80],
    ]);
    expect(card.bowling[0]).toMatchObject({ name: 'Kiran', overs: '1.0', runsConceded: 8, economy: 8 });

    const chase = afterFirstInnings();
    over(chase, 'a1', runs(0, 0, 0, 0, 0, 0));
    expect(chase.scorecards()[1]).toMatchObject({ target: 15, requiredRunRate: 15 });
  });

  it('publishes ball-by-ball commentary to subscribed observers until they unsubscribe', () => {
    const match = newMatch();
    const commentary = new TextCommentary();
    const unsubscribe = match.subscribe(commentary);
    match.start('A');
    match.startOver('b1');
    match.bowl({ runs: 4 });
    match.bowl({ type: BallType.WIDE });
    match.bowl({ wicket: { type: DismissalType.CAUGHT, fielderId: 'b3' } });
    for (const d of runs(0, 0, 0, 0)) match.bowl(d);
    expect(commentary.lines.slice(0, 3)).toEqual([
      '0.1 Kiran to Arjun, FOUR',
      '0.2 Kiran to Arjun, wide',
      '0.2 Kiran to Arjun, OUT! Arjun c Manoj b Kiran',
    ]);
    expect(commentary.lines.at(-1)).toBe('End of over 1: 5 runs, Mariners 5/1');
    unsubscribe();
    match.startOver('b2');
    match.bowl({});
    expect(commentary.lines).toHaveLength(8);
  });
});
