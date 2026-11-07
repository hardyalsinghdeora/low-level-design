import type { ParkingFloor } from '../parking-floor';
import { ParkingSpot, sizeRank } from '../parking-spot';
import type { Vehicle } from '../vehicle';

/**
 * Strategy pattern: how a spot is chosen is a policy the lot owner can swap
 * without touching ParkingLot.
 */
export interface SpotAssignmentStrategy {
  findSpot(floors: readonly ParkingFloor[], vehicle: Vehicle): ParkingSpot | undefined;
}

function candidates(floors: readonly ParkingFloor[], vehicle: Vehicle): ParkingSpot[] {
  return floors.flatMap((floor) => floor.availableSpots()).filter((spot) => spot.canFit(vehicle));
}

/** Lowest floor first, then closest to the entrance. Optimises for the driver. */
export class NearestFirstStrategy implements SpotAssignmentStrategy {
  findSpot(floors: readonly ParkingFloor[], vehicle: Vehicle): ParkingSpot | undefined {
    return candidates(floors, vehicle).sort(
      (a, b) => a.floorNumber - b.floorNumber || a.distanceFromEntrance - b.distanceFromEntrance,
    )[0];
  }
}

/** Smallest spot that fits, so large spots stay free for large vehicles. Optimises for the lot. */
export class BestFitStrategy implements SpotAssignmentStrategy {
  findSpot(floors: readonly ParkingFloor[], vehicle: Vehicle): ParkingSpot | undefined {
    return candidates(floors, vehicle).sort(
      (a, b) =>
        sizeRank(a.size) - sizeRank(b.size) ||
        a.floorNumber - b.floorNumber ||
        a.distanceFromEntrance - b.distanceFromEntrance,
    )[0];
  }
}
