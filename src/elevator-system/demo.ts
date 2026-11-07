import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  CapacityExceededError,
  Direction,
  ElevatorSystem,
  FloorDisplay,
  NearestElevatorStrategy,
  type ElevatorScheduler,
} from './index';

function building(scheduler?: ElevatorScheduler): ElevatorSystem {
  return new ElevatorSystem({
    minFloor: 0,
    maxFloor: 12,
    elevators: [
      { id: 'A', capacity: 6, startFloor: 0 },
      { id: 'B', capacity: 6, startFloor: 6 },
      { id: 'C', capacity: 6, startFloor: 12 },
    ],
    scheduler,
    clock: new FakeClock('2026-03-01T09:00:00Z'),
    ids: new SequentialIdGenerator(),
  });
}

const system = building();
const lobby = new FloorDisplay(0);
system.subscribe(lobby);
const show = (label: string) => console.log(`  step ${String(system.stepCount).padStart(2)} ${label.padEnd(34)} ${lobby.render()}`);

console.log('\nOffice tower, floors 0-12, cars A@0 B@6 C@12, LOOK scheduler');

console.log('\n--- B is sent up to 11; then someone on 7 wants to go DOWN ---');
system.pressFloor('B', 11);
system.step();
show('B heading up');
const look = system.requestElevator(7, Direction.DOWN);
console.log(`  LOOK assigns ${look.requestId} to ${look.elevatorId} (B would have to reach 11 and come back)`);
const nearest = new NearestElevatorStrategy().select({ floor: 7, direction: Direction.DOWN }, system.elevators);
console.log(`  (nearest-car would have picked ${nearest?.id})`);

console.log('\n--- Lobby call UP; A opens at its own floor ---');
const lobbyCall = system.requestElevator(0, Direction.UP);
system.step();
show(`${lobbyCall.requestId} -> ${lobbyCall.elevatorId}`);

console.log('\n--- Seven people try to board A (capacity 6) ---');
const a = system.elevator('A');
try {
  a.board(7);
} catch (error) {
  if (!(error instanceof CapacityExceededError)) throw error;
  console.log(`  ${error.name}: ${error.message}; six board, one waits`);
  a.board(6);
}
system.pressFloor('A', 9);
system.pressFloor('A', 4);

console.log('\n--- Six steps: A sweeps up (4, then 9), C serves floor 7 ---');
for (let i = 0; i < 6; i++) {
  system.step();
  show('');
}

console.log('\n--- C is idle again: take it out for maintenance ---');
system.takeOutOfService('C');
show('C out of service');
const later = system.requestElevator(12, Direction.DOWN);
console.log(`  call from 12 goes to ${later.elevatorId}, never to C (${system.elevator('C').state})`);

system.run(12);
show('after 12 more steps');
console.log(`\nServed calls: ${system.history().filter((h) => h.servedAtStep !== undefined).map((h) => `${h.requestId}@step${h.servedAtStep}`).join(', ')}`);
console.log(`Pending: ${system.pendingRequests().length}`);
