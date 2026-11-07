import { InvalidTimingError } from '../errors';
import { CycleStage, type Direction } from '../signal';

export interface StageDurations {
  green: number;
  yellow: number;
  allRed: number;
}

/** Strategy: how long each stage lasts for the set of directions currently being served. */
export interface TimingPlan {
  durationFor(stage: CycleStage, greenSet: readonly Direction[]): number;
}

function validate(d: StageDurations, label: string): void {
  for (const [key, value] of Object.entries(d)) {
    if (!Number.isInteger(value) || value < 0) throw new InvalidTimingError(`${label} ${key} = ${value}`);
  }
  if (d.green === 0 || d.yellow === 0) throw new InvalidTimingError(`${label} green and yellow must be positive`);
}

function pick(d: StageDurations, stage: CycleStage): number {
  if (stage === CycleStage.GREEN) return d.green;
  if (stage === CycleStage.YELLOW) return d.yellow;
  return d.allRed;
}

export class FixedTimingPlan implements TimingPlan {
  constructor(private readonly durations: StageDurations = { green: 30, yellow: 5, allRed: 2 }) {
    validate(durations, 'fixed');
  }

  durationFor(stage: CycleStage): number {
    return pick(this.durations, stage);
  }
}

/** Longer greens for the main road. The phase lasts as long as its slowest member needs. */
export class PerDirectionTimingPlan implements TimingPlan {
  constructor(private readonly byDirection: Readonly<Record<Direction, StageDurations>>) {
    for (const [d, durations] of Object.entries(byDirection)) validate(durations, d);
  }

  durationFor(stage: CycleStage, greenSet: readonly Direction[]): number {
    return Math.max(...greenSet.map((d) => pick(this.byDirection[d], stage)));
  }
}
