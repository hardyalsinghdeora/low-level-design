import type { Driver } from '../driver';
import type { DistanceFn, Location } from '../geo';

/** Strategy: which ONLINE driver gets the request at `pickup`. */
export interface DriverMatchingStrategy {
  match(drivers: readonly Driver[], pickup: Location, distance: DistanceFn): Driver | null;
}

function inRadius(drivers: readonly Driver[], pickup: Location, distance: DistanceFn, radiusKm: number) {
  return drivers
    .filter((d) => d.isAvailable)
    .map((driver) => ({ driver, km: distance(driver.location, pickup) }))
    .filter((c) => c.km <= radiusKm);
}

/** Shortest pickup time. Ties go to the lower id so results are reproducible. */
export class NearestDriverMatching implements DriverMatchingStrategy {
  constructor(private readonly radiusKm = 3) {}

  match(drivers: readonly Driver[], pickup: Location, distance: DistanceFn): Driver | null {
    const ranked = inRadius(drivers, pickup, distance, this.radiusKm).sort((a, b) => a.km - b.km || a.driver.id.localeCompare(b.driver.id));
    return ranked[0]?.driver ?? null;
  }
}

/** Premium tier: best average rating inside the radius, nearest first on equal ratings. */
export class HighestRatedMatching implements DriverMatchingStrategy {
  constructor(private readonly radiusKm = 3) {}

  match(drivers: readonly Driver[], pickup: Location, distance: DistanceFn): Driver | null {
    const ranked = inRadius(drivers, pickup, distance, this.radiusKm).sort(
      (a, b) => b.driver.ratings.average - a.driver.ratings.average || a.km - b.km || a.driver.id.localeCompare(b.driver.id),
    );
    return ranked[0]?.driver ?? null;
  }
}
