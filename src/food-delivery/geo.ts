/** A point on a local flat grid in kilometres. Real systems use lat/lng and a routing service. */
export interface Location {
  readonly x: number;
  readonly y: number;
}

/** Injected so dispatch and pricing can use road distance in production and simple maths in tests. */
export type DistanceFn = (a: Location, b: Location) => number;

export const straightLineKm: DistanceFn = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const manhattanKm: DistanceFn = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
