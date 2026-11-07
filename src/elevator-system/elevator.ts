import {
  CapacityExceededError,
  InvalidElevatorOperationError,
  InvalidElevatorTransitionError,
  InvalidFloorError,
} from './errors';
import { canTransition, Direction, ElevatorState, movingState } from './elevator-state';

export interface StepResult {
  elevatorId: string;
  floor: number;
  state: ElevatorState;
  moved: boolean;
  /** Set when the door opened at `floor` during this step. */
  doorOpened: boolean;
}

/**
 * One car. It owns its stop set and moves by LOOK: keep going in the travel
 * direction while any stop lies ahead, reverse only when none does. One
 * step moves one floor; a door cycle (open, then close) also takes one step.
 */
export class Elevator {
  private floor: number;
  private stateValue = ElevatorState.IDLE;
  private sweep: Direction | undefined;
  private readonly stops = new Set<number>();
  private passengers = 0;

  constructor(
    readonly id: string,
    readonly capacity: number,
    readonly minFloor: number,
    readonly maxFloor: number,
    startFloor = minFloor,
  ) {
    this.assertFloor(startFloor);
    this.floor = startFloor;
  }

  get currentFloor(): number {
    return this.floor;
  }

  get state(): ElevatorState {
    return this.stateValue;
  }

  /** UP/DOWN while moving or paused at a stop mid-sweep; undefined when idle. */
  get travelDirection(): Direction | undefined {
    return this.stateValue === ElevatorState.IDLE || this.stateValue === ElevatorState.MAINTENANCE
      ? undefined
      : this.sweep;
  }

  get pendingStops(): number[] {
    return [...this.stops].sort((a, b) => a - b);
  }

  get load(): number {
    return this.passengers;
  }

  get isFull(): boolean {
    return this.passengers >= this.capacity;
  }

  get isInService(): boolean {
    return this.stateValue !== ElevatorState.MAINTENANCE;
  }

  addStop(floor: number): void {
    this.assertFloor(floor);
    if (!this.isInService) throw new InvalidElevatorOperationError(this.id, 'accept a stop', this.stateValue);
    if (this.stateValue === ElevatorState.DOOR_OPEN && floor === this.floor) return;
    this.stops.add(floor);
  }

  board(people: number): void {
    this.requireDoorOpen('board');
    const wouldBe = this.passengers + people;
    if (wouldBe > this.capacity) throw new CapacityExceededError(this.id, this.capacity, wouldBe);
    this.passengers = wouldBe;
  }

  alight(people: number): void {
    this.requireDoorOpen('let people out');
    this.passengers = Math.max(0, this.passengers - people);
  }

  enterMaintenance(): void {
    if (this.stops.size > 0) throw new InvalidElevatorOperationError(this.id, 'enter maintenance with stops', 'busy');
    this.transition(ElevatorState.MAINTENANCE);
  }

  exitMaintenance(): void {
    this.transition(ElevatorState.IDLE);
  }

  step(): StepResult {
    const result = (moved: boolean, doorOpened: boolean): StepResult => ({
      elevatorId: this.id,
      floor: this.floor,
      state: this.stateValue,
      moved,
      doorOpened,
    });

    if (this.stateValue === ElevatorState.MAINTENANCE) return result(false, false);
    if (this.stateValue === ElevatorState.IDLE && this.stops.has(this.floor)) {
      this.openDoor();
      return result(false, true);
    }

    // DOOR_OPEN closes here; IDLE and MOVING pick (or keep) a direction.
    const direction = this.chooseDirection();
    if (!direction) {
      if (this.stateValue !== ElevatorState.IDLE) this.transition(ElevatorState.IDLE);
      this.sweep = undefined;
      return result(false, false);
    }
    const target = movingState(direction);
    if (this.stateValue !== target) this.transition(target);
    this.sweep = direction;
    this.floor += direction === Direction.UP ? 1 : -1;

    if (this.stops.has(this.floor)) {
      this.openDoor();
      return result(true, true);
    }
    return result(true, false);
  }

  private chooseDirection(): Direction | undefined {
    const above = this.pendingStops.some((s) => s > this.floor);
    const below = this.pendingStops.some((s) => s < this.floor);
    if (this.sweep === Direction.UP && above) return Direction.UP;
    if (this.sweep === Direction.DOWN && below) return Direction.DOWN;
    if (above && below) {
      // No sweep yet: head for the nearest stop first.
      const nearest = this.pendingStops.reduce((a, b) => (Math.abs(b - this.floor) < Math.abs(a - this.floor) ? b : a));
      return nearest > this.floor ? Direction.UP : Direction.DOWN;
    }
    if (above) return Direction.UP;
    if (below) return Direction.DOWN;
    return undefined;
  }

  private openDoor(): void {
    this.transition(ElevatorState.DOOR_OPEN);
    this.stops.delete(this.floor);
  }

  private transition(to: ElevatorState): void {
    if (!canTransition(this.stateValue, to)) throw new InvalidElevatorTransitionError(this.id, this.stateValue, to);
    this.stateValue = to;
  }

  private requireDoorOpen(operation: string): void {
    if (this.stateValue !== ElevatorState.DOOR_OPEN) {
      throw new InvalidElevatorOperationError(this.id, operation, this.stateValue);
    }
  }

  private assertFloor(floor: number): void {
    if (!Number.isInteger(floor) || floor < this.minFloor || floor > this.maxFloor) throw new InvalidFloorError(floor);
  }
}
