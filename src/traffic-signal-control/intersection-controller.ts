import { Clock, SystemClock } from '../shared/clock';
import { ConflictingGreenError, NoPreemptionActiveError, PreemptionActiveError } from './errors';
import type { Intersection } from './intersection';
import type { SignalObserver } from './observers';
import { conflicts, CycleStage, Direction, SignalColor } from './signal';
import { FixedTimingPlan, type TimingPlan } from './strategies/timing-plan';

export interface IntersectionControllerOptions {
  timing?: TimingPlan;
  /** Groups of mutually compatible directions served together, in cycle order. */
  phases?: readonly (readonly Direction[])[];
  clock?: Clock;
}

const DEFAULT_PHASES: readonly (readonly Direction[])[] = [
  [Direction.NORTH, Direction.SOUTH],
  [Direction.EAST, Direction.WEST],
];

/**
 * Drives the cycle GREEN -> YELLOW -> ALL_RED -> next phase GREEN. Time only
 * moves through tick(seconds) (or sync(), which ticks by the Clock's delta),
 * so the whole simulation is deterministic. After every single light change
 * the intersection's safety invariant is re-checked.
 */
export class IntersectionController {
  private readonly timing: TimingPlan;
  private readonly phases: readonly (readonly Direction[])[];
  private readonly clock: Clock;
  private readonly observers: SignalObserver[] = [];
  private readonly startMs: number;
  private stage = CycleStage.GREEN;
  private greenSet: Direction[];
  private phaseIndex = 0;
  private elapsedInStage = 0;
  private simulatedSeconds = 0;
  private preemption: Direction | undefined;

  constructor(
    readonly intersection: Intersection,
    options: IntersectionControllerOptions = {},
  ) {
    this.timing = options.timing ?? new FixedTimingPlan();
    this.phases = options.phases ?? DEFAULT_PHASES;
    this.clock = options.clock ?? new SystemClock();
    this.startMs = this.clock.now().getTime();
    for (const phase of this.phases) {
      for (const a of phase) for (const b of phase) if (conflicts(a, b)) throw new ConflictingGreenError(a, b);
    }
    this.greenSet = [...(this.phases[0] ?? [])];
    this.setColor(this.greenSet, SignalColor.GREEN);
  }

  get currentStage(): CycleStage {
    return this.stage;
  }

  get currentGreen(): readonly Direction[] {
    return this.greenSet;
  }

  get activePreemption(): Direction | undefined {
    return this.preemption;
  }

  get now(): Date {
    return new Date(this.startMs + this.simulatedSeconds * 1_000);
  }

  subscribe(observer: SignalObserver): () => void {
    this.observers.push(observer);
    return () => {
      const i = this.observers.indexOf(observer);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  /** Advances simulated time. A big tick is identical to many small ones. */
  tick(seconds: number): void {
    if (!Number.isInteger(seconds) || seconds < 0) throw new RangeError(`Invalid tick ${seconds}`);
    let remaining = seconds;
    this.advanceExpiredStages();
    while (remaining > 0) {
      const step = Math.min(this.stageDuration() - this.elapsedInStage, remaining);
      this.elapsedInStage += step;
      this.simulatedSeconds += step;
      remaining -= step;
      this.advanceExpiredStages();
    }
  }

  /** Catches simulated time up with the injected Clock. */
  sync(): void {
    const behind = Math.floor((this.clock.now().getTime() - this.now.getTime()) / 1_000);
    if (behind > 0) this.tick(behind);
  }

  /**
   * Emergency vehicle approaching from `direction`. A conflicting green is cut
   * short (it still shows yellow and the all-red clearance); if the direction
   * is already green, its green is held until clearPreemption().
   */
  preempt(direction: Direction): void {
    if (this.preemption) throw new PreemptionActiveError(this.preemption, direction);
    this.preemption = direction;
    if (this.stage === CycleStage.GREEN && !this.greenSet.includes(direction)) this.advanceStage();
  }

  clearPreemption(): void {
    if (!this.preemption) throw new NoPreemptionActiveError();
    this.preemption = undefined;
    this.advanceExpiredStages();
  }

  private holdingGreen(): boolean {
    return this.stage === CycleStage.GREEN && this.preemption !== undefined && this.greenSet.includes(this.preemption);
  }

  private stageDuration(): number {
    return this.holdingGreen() ? Infinity : this.timing.durationFor(this.stage, this.greenSet);
  }

  private advanceExpiredStages(): void {
    while (this.elapsedInStage >= this.stageDuration()) this.advanceStage();
  }

  private advanceStage(): void {
    if (this.stage === CycleStage.GREEN) {
      this.setColor(this.greenSet, SignalColor.YELLOW);
      this.stage = CycleStage.YELLOW;
    } else if (this.stage === CycleStage.YELLOW) {
      this.setColor(this.greenSet, SignalColor.RED);
      this.stage = CycleStage.ALL_RED;
    } else {
      this.greenSet = this.chooseNextGreen();
      this.setColor(this.greenSet, SignalColor.GREEN);
      this.stage = CycleStage.GREEN;
    }
    this.elapsedInStage = 0;
  }

  private chooseNextGreen(): Direction[] {
    const target = this.preemption;
    if (target) {
      const index = this.phases.findIndex((p) => p.includes(target));
      if (index >= 0) this.phaseIndex = index;
      return [target];
    }
    this.phaseIndex = (this.phaseIndex + 1) % this.phases.length;
    return [...(this.phases[this.phaseIndex] ?? [])];
  }

  private setColor(directions: readonly Direction[], color: SignalColor): void {
    for (const direction of directions) {
      const from = this.intersection.light(direction).changeTo(color);
      this.intersection.assertSafe();
      const event = {
        direction,
        from,
        to: color,
        at: this.now,
        snapshot: this.intersection.snapshot(),
        preemptedFor: this.preemption,
      };
      for (const o of this.observers) o.onSignalChange(event);
    }
  }
}
