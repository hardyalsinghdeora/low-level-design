import { ParkingSpot, SpotSize } from './parking-spot';

export class ParkingFloor {
  private readonly spots = new Map<string, ParkingSpot>();

  constructor(readonly number: number) {}

  addSpot(spot: ParkingSpot): this {
    if (spot.floorNumber !== this.number) {
      throw new RangeError(`Spot ${spot.id} belongs to floor ${spot.floorNumber}, not ${this.number}`);
    }
    if (this.spots.has(spot.id)) throw new RangeError(`Duplicate spot id ${spot.id}`);
    this.spots.set(spot.id, spot);
    return this;
  }

  get allSpots(): ParkingSpot[] {
    return [...this.spots.values()];
  }

  availableSpots(): ParkingSpot[] {
    return this.allSpots.filter((spot) => spot.isAvailable);
  }

  availabilityBySize(): Record<SpotSize, number> {
    const counts: Record<SpotSize, number> = {
      [SpotSize.SMALL]: 0,
      [SpotSize.MEDIUM]: 0,
      [SpotSize.LARGE]: 0,
    };
    for (const spot of this.availableSpots()) counts[spot.size] += 1;
    return counts;
  }
}
