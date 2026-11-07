import { SpotEmptyError, SpotOccupiedError, VehicleDoesNotFitError } from './errors';
import { Vehicle, VehicleType } from './vehicle';

export enum SpotSize {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
}

const SIZE_RANK: Record<SpotSize, number> = {
  [SpotSize.SMALL]: 0,
  [SpotSize.MEDIUM]: 1,
  [SpotSize.LARGE]: 2,
};

/** The smallest spot each vehicle type can use. A vehicle may also take any larger spot. */
export const MIN_SPOT_SIZE: Record<VehicleType, SpotSize> = {
  [VehicleType.MOTORCYCLE]: SpotSize.SMALL,
  [VehicleType.CAR]: SpotSize.MEDIUM,
  [VehicleType.TRUCK]: SpotSize.LARGE,
};

export function sizeRank(size: SpotSize): number {
  return SIZE_RANK[size];
}

export class ParkingSpot {
  private vehicle: Vehicle | null = null;

  constructor(
    readonly id: string,
    readonly size: SpotSize,
    readonly floorNumber: number,
    /** Walking distance from the entrance; used by the nearest-first strategy. */
    readonly distanceFromEntrance: number = 0,
  ) {}

  get isAvailable(): boolean {
    return this.vehicle === null;
  }

  get parkedVehicle(): Vehicle | null {
    return this.vehicle;
  }

  canFit(vehicle: Vehicle): boolean {
    return SIZE_RANK[this.size] >= SIZE_RANK[MIN_SPOT_SIZE[vehicle.type]];
  }

  /**
   * Occupies the spot. Throws instead of silently overwriting, so a double
   * assignment (two gates picking the same spot) can never be lost.
   */
  park(vehicle: Vehicle): void {
    if (!this.isAvailable) throw new SpotOccupiedError(this.id);
    if (!this.canFit(vehicle)) throw new VehicleDoesNotFitError(vehicle.licensePlate, this.id);
    this.vehicle = vehicle;
  }

  unpark(): Vehicle {
    if (this.vehicle === null) throw new SpotEmptyError(this.id);
    const vehicle = this.vehicle;
    this.vehicle = null;
    return vehicle;
  }
}
