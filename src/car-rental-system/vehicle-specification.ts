import type { Money } from '../shared/money';
import type { Transmission, Vehicle, VehicleCategory } from './vehicle';

/**
 * Specification pattern: every search filter is a small predicate object, and
 * `and` / `or` / `not` compose them. A new filter is a new class, not a new
 * optional parameter on `search()`.
 */
export interface Specification<T> {
  isSatisfiedBy(candidate: T): boolean;
}

export abstract class CompositeSpecification<T> implements Specification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;

  and(other: Specification<T>): CompositeSpecification<T> {
    return new AndSpecification(this, other);
  }

  or(other: Specification<T>): CompositeSpecification<T> {
    return new OrSpecification(this, other);
  }

  not(): CompositeSpecification<T> {
    return new NotSpecification(this);
  }
}

class AndSpecification<T> extends CompositeSpecification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
}

class OrSpecification<T> extends CompositeSpecification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
}

class NotSpecification<T> extends CompositeSpecification<T> {
  constructor(private readonly inner: Specification<T>) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
}

export class AnyVehicleSpec extends CompositeSpecification<Vehicle> {
  isSatisfiedBy(): boolean {
    return true;
  }
}

export class CategorySpec extends CompositeSpecification<Vehicle> {
  constructor(private readonly category: VehicleCategory) {
    super();
  }

  isSatisfiedBy(vehicle: Vehicle): boolean {
    return vehicle.category === this.category;
  }
}

export class StoreSpec extends CompositeSpecification<Vehicle> {
  constructor(private readonly storeId: string) {
    super();
  }

  isSatisfiedBy(vehicle: Vehicle): boolean {
    return vehicle.storeId === this.storeId;
  }
}

export class MaxDailyRateSpec extends CompositeSpecification<Vehicle> {
  constructor(private readonly cap: Money) {
    super();
  }

  isSatisfiedBy(vehicle: Vehicle): boolean {
    return vehicle.dailyRate <= this.cap;
  }
}

export class TransmissionSpec extends CompositeSpecification<Vehicle> {
  constructor(private readonly transmission: Transmission) {
    super();
  }

  isSatisfiedBy(vehicle: Vehicle): boolean {
    return vehicle.transmission === this.transmission;
  }
}
