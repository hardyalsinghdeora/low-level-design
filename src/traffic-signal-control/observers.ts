import type { SignalSnapshot } from './intersection';
import { SignalColor, type Direction } from './signal';

export interface SignalChangeEvent {
  direction: Direction;
  from: SignalColor;
  to: SignalColor;
  at: Date;
  snapshot: SignalSnapshot;
  preemptedFor?: Direction;
}

/** Observer: anything that reacts to a light changing. The controller does not know who listens. */
export interface SignalObserver {
  onSignalChange(event: SignalChangeEvent): void;
}

/** A roadside board that keeps a readable log of changes. */
export class DisplayBoard implements SignalObserver {
  readonly log: string[] = [];

  onSignalChange(e: SignalChangeEvent): void {
    const tag = e.preemptedFor ? ` [emergency ${e.preemptedFor}]` : '';
    this.log.push(`${e.at.toISOString().slice(11, 19)} ${e.direction} ${e.from} -> ${e.to}${tag}`);
  }
}

export enum PedestrianState {
  WALK = 'WALK',
  DONT_WALK = 'DONT_WALK',
}

/** A crosswalk shows WALK only while every approach that crosses it is RED. */
export class PedestrianSignal implements SignalObserver {
  private current = PedestrianState.DONT_WALK;

  constructor(
    readonly crosswalk: string,
    private readonly crossingTraffic: readonly Direction[],
  ) {}

  get state(): PedestrianState {
    return this.current;
  }

  onSignalChange(e: SignalChangeEvent): void {
    const clear = this.crossingTraffic.every((d) => e.snapshot[d] === SignalColor.RED);
    this.current = clear ? PedestrianState.WALK : PedestrianState.DONT_WALK;
  }
}
