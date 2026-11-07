import type { Elevator } from '../elevator';
import { Direction } from '../elevator-state';
import type { HallCall } from '../requests';

/** Strategy: which car answers a hall call. Cars in MAINTENANCE or already full are never candidates. */
export interface ElevatorScheduler {
  readonly name: string;
  select(call: HallCall, elevators: readonly Elevator[]): Elevator | undefined;
}

function candidates(elevators: readonly Elevator[]): Elevator[] {
  return elevators.filter((e) => e.isInService && !e.isFull);
}

function cheapest(elevators: readonly Elevator[], cost: (e: Elevator) => number): Elevator | undefined {
  let best: Elevator | undefined;
  let bestCost = Infinity;
  for (const e of candidates(elevators)) {
    const c = cost(e);
    if (c < bestCost) {
      best = e;
      bestCost = c;
    }
  }
  return best;
}

/** Closest car by floors, ignoring where it is heading. Simple, and often wrong at rush hour. */
export class NearestElevatorStrategy implements ElevatorScheduler {
  readonly name = 'nearest';

  select(call: HallCall, elevators: readonly Elevator[]): Elevator | undefined {
    return cheapest(elevators, (e) => Math.abs(e.currentFloor - call.floor));
  }
}

/**
 * Direction-aware LOOK cost: a car already sweeping towards the caller in the
 * caller's direction costs just the distance; any other moving car must
 * finish its sweep (to its farthest stop) and come back.
 */
export class LookSchedulerStrategy implements ElevatorScheduler {
  readonly name = 'look';

  select(call: HallCall, elevators: readonly Elevator[]): Elevator | undefined {
    return cheapest(elevators, (e) => this.cost(e, call));
  }

  cost(e: Elevator, call: HallCall): number {
    const here = e.currentFloor;
    const direction = e.travelDirection;
    if (!direction) return Math.abs(here - call.floor);
    if (direction === Direction.UP) {
      if (call.direction === Direction.UP && call.floor >= here) return call.floor - here;
      const peak = Math.max(here, call.floor, ...e.pendingStops);
      return peak - here + (peak - call.floor);
    }
    if (call.direction === Direction.DOWN && call.floor <= here) return here - call.floor;
    const trough = Math.min(here, call.floor, ...e.pendingStops);
    return here - trough + (call.floor - trough);
  }
}
