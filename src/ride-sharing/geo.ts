/** A point on a local flat grid in kilometres; production would use lat/lng and a routing engine. */
export interface Location {
  readonly x: number;
  readonly y: number;
}

/** Injected so matching and fares agree on one distance, and tests need no map service. */
export type DistanceFn = (a: Location, b: Location) => number;

export const straightLineKm: DistanceFn = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
