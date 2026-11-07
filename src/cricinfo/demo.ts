import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { BallType, DismissalType, Match, Team, TextCommentary, type Delivery } from './index';

const mariners = new Team('MAR', 'Mariners', [
  { id: 'arjun', name: 'Arjun' },
  { id: 'bala', name: 'Bala' },
  { id: 'chetan', name: 'Chetan' },
  { id: 'dhruv', name: 'Dhruv' },
]);
const chargers = new Team('CHA', 'Chargers', [
  { id: 'kiran', name: 'Kiran' },
  { id: 'lalit', name: 'Lalit' },
  { id: 'manoj', name: 'Manoj' },
  { id: 'nikhil', name: 'Nikhil' },
]);

const clock = new FakeClock('2026-04-12T14:00:00Z');
const match = new Match(mariners, chargers, 2, { clock, ids: new SequentialIdGenerator() });
const commentary = new TextCommentary();
match.subscribe(commentary);
console.log(`\n${match.id}: ${mariners.name} v ${chargers.name}, ${match.oversLimit} overs a side (${match.status})`);

function over(bowlerId: string, deliveries: Delivery[]): void {
  match.startOver(bowlerId);
  for (const d of deliveries) {
    clock.advanceSeconds(40);
    if (match.status === 'LIVE') match.bowl(d);
  }
}

match.start('MAR');
over('kiran', [{ runs: 4 }, { type: BallType.WIDE }, { runs: 1 }, {}, { type: BallType.NO_BALL, runs: 6 }, { runs: 2 }, {}, { runs: 1 }]);

console.log('\n--- Kiran tries to bowl the next over too ---');
try {
  match.startOver('kiran');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
over('lalit', [{ type: BallType.LEG_BYE, runs: 1 }, { wicket: { type: DismissalType.BOWLED } }, { runs: 3 }, {}, {}, { runs: 1 }]);

const [first] = match.scorecards();
console.log(`\n${first.team} ${first.score} (${first.overs} ov, RR ${first.runRate}), extras ${first.extras.total}`);
for (const b of first.batting) console.log(`  ${b.name.padEnd(8)} ${b.runs} (${b.balls}) ${b.dismissal ?? 'not out'}`);
for (const b of first.bowling) console.log(`  ${b.name.padEnd(8)} ${b.overs}-${b.maidens}-${b.runsConceded}-${b.wickets}`);

console.log('\n--- Chase ---');
over('arjun', [{ runs: 1 }, {}, { type: BallType.BYE, runs: 4 }, { wicket: { type: DismissalType.CAUGHT, fielderId: 'bala' } }, { runs: 6 }, {}]);
const chase = match.scorecards()[1];
console.log(`  after 1 over ${chase.score}, need ${(chase.target ?? 0) - Number(chase.score.split('/')[0])} at RRR ${chase.requiredRunRate}`);
over('bala', [{ runs: 4 }, { runs: 6 }, { runs: 2 }, { runs: 4 }, { runs: 1 }, { runs: 1 }]);

console.log('\n--- Commentary (last 8 lines) ---');
for (const line of commentary.lines.slice(-8)) console.log(`  ${line}`);
console.log(`\nStatus: ${match.status}. ${match.result?.summary}`);
