import { InvalidSignalTransitionError } from './errors';
import type { Direction, SignalColor } from './signal';
import { RED_STATE, type LightState } from './states/light-state';

/** One signal head facing one approach. Starts RED, the only safe power-on state. */
export class TrafficLight {
  private state: LightState = RED_STATE;

  constructor(readonly direction: Direction) {}

  get color(): SignalColor {
    return this.state.color;
  }

  /** Moves to `color`, which must be the current state's successor. Returns the previous colour. */
  changeTo(color: SignalColor): SignalColor {
    const next = this.state.next();
    if (next.color !== color) throw new InvalidSignalTransitionError(this.direction, this.state.color, color);
    const previous = this.state.color;
    this.state = next;
    return previous;
  }
}
