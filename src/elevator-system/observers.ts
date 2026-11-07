import type { ElevatorState } from './elevator-state';

export interface ElevatorEvent {
  elevatorId: string;
  floor: number;
  state: ElevatorState;
  step: number;
}

/** Observer: displays, telemetry, the building's access-control system. */
export interface ElevatorObserver {
  onElevatorEvent(event: ElevatorEvent): void;
}

/** The panel above each landing door: where every car is and what it is doing. */
export class FloorDisplay implements ElevatorObserver {
  private readonly positions = new Map<string, ElevatorEvent>();
  updates = 0;

  constructor(readonly floor: number) {}

  onElevatorEvent(event: ElevatorEvent): void {
    this.positions.set(event.elevatorId, event);
    this.updates += 1;
  }

  render(): string {
    return [...this.positions.values()].map((e) => `${e.elevatorId}@${e.floor} ${e.state}`).join(' | ');
  }
}
