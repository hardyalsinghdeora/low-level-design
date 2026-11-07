import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  canTransition,
  CapacityExceededError,
  Direction,
  Elevator,
  ElevatorState,
  ElevatorSystem,
  FloorDisplay,
  InvalidElevatorOperationError,
  InvalidElevatorTransitionError,
  InvalidFloorError,
  LookSchedulerStrategy,
  NearestElevatorStrategy,
  NoElevatorAvailableError,
  type ElevatorScheduler,
} from './index';

function build(scheduler?: ElevatorScheduler, e2Start = 5) {
  return new ElevatorSystem({
    minFloor: 0,
    maxFloor: 10,
    elevators: [
      { id: 'E1', capacity: 4, startFloor: 0 },
      { id: 'E2', capacity: 4, startFloor: e2Start },
    ],
    scheduler,
    clock: new FakeClock('2026-03-01T09:00:00Z'),
    ids: new SequentialIdGenerator(),
  });
}

/** E2 starts at 5 heading for 10; after one step it is at 6, MOVING_UP. */
function withE2GoingUp(scheduler: ElevatorScheduler) {
  const system = build(scheduler);
  system.pressFloor('E2', 10);
  system.step();
  return system;
}

/** Floors at which the car opened its door during `steps` steps. */
function doorOpenings(car: Elevator, steps: number): number[] {
  const floors: number[] = [];
  for (let i = 0; i < steps; i++) if (car.step().doorOpened) floors.push(car.currentFloor);
  return floors;
}

describe('Scheduler strategies', () => {
  it('nearest picks the closest car even if it is moving away', () => {
    const system = withE2GoingUp(new NearestElevatorStrategy());
    expect(system.requestElevator(5, Direction.DOWN).elevatorId).toBe('E2');
  });

  it('LOOK avoids a car that must finish its sweep first', () => {
    const look = new LookSchedulerStrategy();
    const system = withE2GoingUp(look);
    expect(look.cost(system.elevator('E2'), { floor: 5, direction: Direction.DOWN })).toBe(4 + 5);
    expect(system.requestElevator(5, Direction.DOWN).elevatorId).toBe('E1');
  });

  it('LOOK picks a car already heading towards the caller in the same direction', () => {
    const system = withE2GoingUp(new LookSchedulerStrategy());
    const assignment = system.requestElevator(8, Direction.UP);
    expect(assignment).toMatchObject({ requestId: 'CALL-1', elevatorId: 'E2' });
    system.run(2);
    expect(system.elevator('E2').state).toBe(ElevatorState.DOOR_OPEN);
    expect(system.pendingRequests()).toHaveLength(0);
    expect(assignment.servedAtStep).toBe(3);
  });

  it('never assigns cars in MAINTENANCE', () => {
    const system = build(new NearestElevatorStrategy());
    system.elevator('E2').enterMaintenance();
    expect(system.requestElevator(5, Direction.UP).elevatorId).toBe('E1');
    system.run(3);
    expect(system.elevator('E2').state).toBe(ElevatorState.MAINTENANCE);
    const empty = build();
    empty.elevator('E1').enterMaintenance();
    empty.elevator('E2').enterMaintenance();
    expect(() => empty.requestElevator(3, Direction.UP)).toThrow(NoElevatorAvailableError);
    expect(() => empty.pressFloor('E1', 4)).toThrow(InvalidElevatorOperationError);
  });
});

describe('Elevator movement', () => {
  it('LOOK keeps its direction while stops remain ahead, then reverses', () => {
    const car = new Elevator('A', 8, 0, 10, 5);
    car.addStop(8);
    car.step(); // 6, MOVING_UP
    car.addStop(2); // behind
    car.addStop(7); // ahead
    expect(doorOpenings(car, 12)).toEqual([7, 8, 2]);
    expect(car.state).toBe(ElevatorState.IDLE);
  });

  it('a door cycle takes exactly one step', () => {
    const car = new Elevator('A', 8, 0, 10, 0);
    car.addStop(1);
    car.addStop(3);
    expect(car.step()).toMatchObject({ floor: 1, state: ElevatorState.DOOR_OPEN, doorOpened: true });
    expect(car.step()).toMatchObject({ floor: 2, state: ElevatorState.MOVING_UP, moved: true });
    car.step();
    expect(car.state).toBe(ElevatorState.DOOR_OPEN);
    expect(car.step()).toMatchObject({ floor: 3, state: ElevatorState.IDLE, moved: false });
  });

  it('opens without moving for a call at its own floor', () => {
    const car = new Elevator('A', 8, 0, 10, 4);
    car.addStop(4);
    expect(car.step()).toMatchObject({ floor: 4, state: ElevatorState.DOOR_OPEN, moved: false });
  });

  it('validates transitions: a moving car cannot enter maintenance', () => {
    const car = new Elevator('A', 8, 0, 10, 0);
    car.addStop(5);
    car.step();
    expect(() => car.enterMaintenance()).toThrow(InvalidElevatorOperationError);
    expect(canTransition(ElevatorState.MOVING_UP, ElevatorState.MOVING_DOWN)).toBe(false);
    expect(canTransition(ElevatorState.MOVING_UP, ElevatorState.MAINTENANCE)).toBe(false);
    const idle = new Elevator('B', 8, 0, 10, 0);
    expect(() => idle.exitMaintenance()).toThrow(InvalidElevatorTransitionError);
  });
});

describe('Capacity, floors and observers', () => {
  it('enforces capacity and skips full cars when scheduling', () => {
    const system = build(new NearestElevatorStrategy(), 1);
    system.pressFloor('E2', 1);
    system.step();
    const e2 = system.elevator('E2');
    expect(() => e2.board(5)).toThrow(CapacityExceededError);
    e2.board(4);
    expect(e2.isFull).toBe(true);
    expect(system.requestElevator(2, Direction.UP).elevatorId).toBe('E1');
    expect(() => system.elevator('E1').board(1)).toThrow(InvalidElevatorOperationError);
  });

  it('rejects floors outside the building and impossible hall buttons', () => {
    const system = build();
    expect(() => system.requestElevator(11, Direction.DOWN)).toThrow(InvalidFloorError);
    expect(() => system.requestElevator(10, Direction.UP)).toThrow(InvalidFloorError);
    expect(() => system.pressFloor('E1', -1)).toThrow(InvalidFloorError);
  });

  it('floor displays receive every floor and state change', () => {
    const system = build();
    const lobby = new FloorDisplay(0);
    system.subscribe(lobby);
    system.pressFloor('E1', 2);
    system.run(2);
    expect(lobby.updates).toBe(2);
    expect(lobby.render()).toBe('E1@2 DOOR_OPEN');
    system.run(1);
    expect(lobby.render()).toBe('E1@2 IDLE');
    system.takeOutOfService('E2');
    expect(lobby.render()).toBe('E1@2 IDLE | E2@5 MAINTENANCE');
    system.returnToService('E2');
    expect(system.elevator('E2').state).toBe(ElevatorState.IDLE);
  });
});
