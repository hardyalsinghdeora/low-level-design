import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { Elevator } from './elevator';
import { Direction } from './elevator-state';
import { ElevatorNotFoundError, InvalidFloorError, NoElevatorAvailableError } from './errors';
import type { ElevatorObserver } from './observers';
import type { HallAssignment } from './requests';
import { LookSchedulerStrategy, type ElevatorScheduler } from './strategies/scheduler';

export interface ElevatorSpec {
  id: string;
  capacity: number;
  startFloor?: number;
}

export interface ElevatorSystemOptions {
  minFloor: number;
  maxFloor: number;
  elevators: readonly ElevatorSpec[];
  scheduler?: ElevatorScheduler;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * The building controller. It assigns hall calls through the scheduler
 * Strategy, forwards car calls, advances every car one step at a time, and
 * tells observers what changed. It never moves a car itself.
 */
export class ElevatorSystem {
  readonly minFloor: number;
  readonly maxFloor: number;
  private readonly cars: Elevator[];
  private scheduler: ElevatorScheduler;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly observers: ElevatorObserver[] = [];
  private readonly assignments: HallAssignment[] = [];
  private steps = 0;

  constructor(options: ElevatorSystemOptions) {
    this.minFloor = options.minFloor;
    this.maxFloor = options.maxFloor;
    this.cars = options.elevators.map(
      (s) => new Elevator(s.id, s.capacity, options.minFloor, options.maxFloor, s.startFloor ?? options.minFloor),
    );
    this.scheduler = options.scheduler ?? new LookSchedulerStrategy();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  get elevators(): readonly Elevator[] {
    return this.cars;
  }

  get stepCount(): number {
    return this.steps;
  }

  elevator(id: string): Elevator {
    const car = this.cars.find((e) => e.id === id);
    if (!car) throw new ElevatorNotFoundError(id);
    return car;
  }

  setScheduler(scheduler: ElevatorScheduler): void {
    this.scheduler = scheduler;
  }

  subscribe(observer: ElevatorObserver): () => void {
    this.observers.push(observer);
    return () => {
      const i = this.observers.indexOf(observer);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  /** Hall call from a landing. */
  requestElevator(floor: number, direction: Direction): HallAssignment {
    if (!Number.isInteger(floor) || floor < this.minFloor || floor > this.maxFloor) throw new InvalidFloorError(floor);
    if ((direction === Direction.UP && floor === this.maxFloor) || (direction === Direction.DOWN && floor === this.minFloor)) {
      throw new InvalidFloorError(floor, `has no ${direction} button`);
    }
    const car = this.scheduler.select({ floor, direction }, this.cars);
    if (!car) throw new NoElevatorAvailableError(floor);
    car.addStop(floor);
    const assignment: HallAssignment = {
      requestId: this.ids.next('CALL'),
      floor,
      direction,
      elevatorId: car.id,
      requestedAt: this.clock.now(),
    };
    this.assignments.push(assignment);
    return assignment;
  }

  /** Car call: a passenger inside presses a floor button. */
  pressFloor(elevatorId: string, floor: number): void {
    this.elevator(elevatorId).addStop(floor);
  }

  /** Maintenance is entered through the system so displays hear about it. */
  takeOutOfService(elevatorId: string): void {
    const car = this.elevator(elevatorId);
    car.enterMaintenance();
    this.notify(car);
  }

  returnToService(elevatorId: string): void {
    const car = this.elevator(elevatorId);
    car.exitMaintenance();
    this.notify(car);
  }

  step(): void {
    this.steps += 1;
    for (const car of this.cars) {
      const before = { floor: car.currentFloor, state: car.state };
      const result = car.step();
      if (result.doorOpened) {
        for (const a of this.assignments) {
          if (a.elevatorId === car.id && a.floor === result.floor && a.servedAtStep === undefined) {
            a.servedAtStep = this.steps;
          }
        }
      }
      if (before.floor !== result.floor || before.state !== result.state) this.notify(car);
    }
  }

  private notify(car: Elevator): void {
    const event = { elevatorId: car.id, floor: car.currentFloor, state: car.state, step: this.steps };
    for (const o of this.observers) o.onElevatorEvent(event);
  }

  run(steps: number): void {
    for (let i = 0; i < steps; i++) this.step();
  }

  pendingRequests(): HallAssignment[] {
    return this.assignments.filter((a) => a.servedAtStep === undefined);
  }

  history(): readonly HallAssignment[] {
    return this.assignments;
  }
}
