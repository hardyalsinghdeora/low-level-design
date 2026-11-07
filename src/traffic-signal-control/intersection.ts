import { ConflictingGreenError } from './errors';
import { ALL_DIRECTIONS, conflicts, SignalColor, type Direction } from './signal';
import { TrafficLight } from './traffic-light';

export type SignalSnapshot = Readonly<Record<Direction, SignalColor>>;

/** The four signal heads plus the conflict rule. Knows nothing about timing. */
export class Intersection {
  private readonly lights = new Map<Direction, TrafficLight>();

  constructor(readonly name: string) {
    for (const d of ALL_DIRECTIONS) this.lights.set(d, new TrafficLight(d));
  }

  light(direction: Direction): TrafficLight {
    const light = this.lights.get(direction);
    if (!light) throw new RangeError(`No light for ${direction}`);
    return light;
  }

  snapshot(): SignalSnapshot {
    const snap = {} as Record<Direction, SignalColor>;
    for (const [d, light] of this.lights) snap[d] = light.color;
    return snap;
  }

  /** Yellow still means traffic is in the box, so it counts as moving. */
  assertSafe(): void {
    const moving = [...this.lights.values()].filter((l) => l.color !== SignalColor.RED).map((l) => l.direction);
    for (const a of moving) {
      for (const b of moving) {
        if (a < b && conflicts(a, b)) throw new ConflictingGreenError(a, b);
      }
    }
  }
}
