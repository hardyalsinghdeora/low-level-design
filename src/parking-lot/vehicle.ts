export enum VehicleType {
  MOTORCYCLE = 'MOTORCYCLE',
  CAR = 'CAR',
  TRUCK = 'TRUCK',
}

/**
 * Abstract base: the lot never cares which concrete class it gets, only the
 * `type`, which drives spot compatibility and pricing.
 */
export abstract class Vehicle {
  protected constructor(
    readonly licensePlate: string,
    readonly type: VehicleType,
  ) {
    if (!licensePlate.trim()) throw new RangeError('licensePlate is required');
  }
}

export class Motorcycle extends Vehicle {
  constructor(licensePlate: string) {
    super(licensePlate, VehicleType.MOTORCYCLE);
  }
}

export class Car extends Vehicle {
  constructor(licensePlate: string) {
    super(licensePlate, VehicleType.CAR);
  }
}

export class Truck extends Vehicle {
  constructor(licensePlate: string) {
    super(licensePlate, VehicleType.TRUCK);
  }
}
