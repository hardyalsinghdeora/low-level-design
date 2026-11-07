import { FakeClock } from '../shared/clock';
import {
  Direction,
  DisplayBoard,
  FixedTimingPlan,
  Intersection,
  IntersectionController,
  PedestrianSignal,
  PreemptionActiveError,
  type SignalSnapshot,
} from './index';

const clock = new FakeClock('2026-03-01T08:00:00Z');
const controller = new IntersectionController(new Intersection('MG Road & Brigade Road'), {
  timing: new FixedTimingPlan({ green: 30, yellow: 5, allRed: 2 }),
  clock,
});
const board = new DisplayBoard();
const crosswalk = new PedestrianSignal('crosswalk across MG Road (E-W)', [Direction.EAST, Direction.WEST]);
controller.subscribe(board);
controller.subscribe(crosswalk);

const fmt = (s: SignalSnapshot): string => `N:${s.NORTH} S:${s.SOUTH} E:${s.EAST} W:${s.WEST}`;
let printed = 0;
function report(label: string): void {
  console.log(`\n${controller.now.toISOString().slice(11, 19)} ${label}`);
  for (const line of board.log.slice(printed)) console.log(`  ${line}`);
  printed = board.log.length;
  console.log(`  now ${fmt(controller.intersection.snapshot())} | pedestrians: ${crosswalk.state}`);
}

console.log(`${controller.intersection.name}, cycle 30s green / 5s yellow / 2s all-red`);
report('power on');

controller.tick(37);
report('after one north-south phase (tick 37s)');

clock.advanceSeconds(77);
controller.sync();
report('clock reads +77s; sync() catches up to the next north-south green');

console.log('\n--- Ambulance approaching from the EAST while north-south is green ---');
controller.preempt(Direction.EAST);
controller.tick(7);
report('north-south cut short; only EAST is green');

console.log('\n--- A fire truck from the WEST asks for preemption too ---');
try {
  controller.preempt(Direction.WEST);
} catch (error) {
  if (!(error instanceof PreemptionActiveError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
}

controller.tick(120);
report('EAST green held for 2 minutes while the ambulance clears');

controller.clearPreemption();
controller.tick(7);
report('preemption cleared; normal cycle resumes');
