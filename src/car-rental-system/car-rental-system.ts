import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { DateRange } from './date-range';
import {
  InvalidRentalPeriodError,
  ReservationNotFoundError,
  StoreNotFoundError,
  VehicleNotFoundError,
} from './errors';
import type { Invoice } from './invoice';
import { Reservation, type RentalExtra, type RentalTerms } from './reservation';
import type { Store } from './store';
import type { PricingStrategy } from './strategies/pricing';
import type { Vehicle } from './vehicle';
import { VehicleCalendar } from './vehicle-calendar';
import { AnyVehicleSpec, type Specification } from './vehicle-specification';

export interface ReservationRequest {
  customerId: string;
  vehicleId: string;
  period: DateRange;
  /** Defaults to the pickup store. A different store makes it a one-way rental. */
  returnStoreId?: string;
  extras?: RentalExtra[];
}

export interface CarRentalSystemOptions {
  pricing: PricingStrategy;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root and application service. Owns the fleet, one calendar per
 * vehicle and every reservation, and is the only place that coordinates search,
 * booking, pickup and return. The rules themselves live in the entities.
 */
export class CarRentalSystem {
  private readonly stores = new Map<string, Store>();
  private readonly vehicles = new Map<string, Vehicle>();
  private readonly calendars = new Map<string, VehicleCalendar>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly pricing: PricingStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: CarRentalSystemOptions) {
    this.pricing = options.pricing;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addStore(store: Store): this {
    if (this.stores.has(store.id)) throw new RangeError(`Store ${store.id} already exists`);
    this.stores.set(store.id, store);
    return this;
  }

  addVehicle(vehicle: Vehicle): this {
    this.requireStore(vehicle.storeId);
    if (this.vehicles.has(vehicle.id)) throw new RangeError(`Vehicle ${vehicle.id} already exists`);
    this.vehicles.set(vehicle.id, vehicle);
    this.calendars.set(vehicle.id, new VehicleCalendar(vehicle.id));
    return this;
  }

  /** Vehicles that satisfy `filter` and are free for the whole period. */
  search(period: DateRange, filter: Specification<Vehicle> = new AnyVehicleSpec()): Vehicle[] {
    return [...this.vehicles.values()].filter(
      (vehicle) => filter.isSatisfiedBy(vehicle) && this.calendarOf(vehicle.id).isFree(period),
    );
  }

  reserve(request: ReservationRequest): Reservation {
    const vehicle = this.requireVehicle(request.vehicleId);
    if (request.period.start.getTime() < this.clock.now().getTime()) {
      throw new InvalidRentalPeriodError('pickup time is in the past');
    }
    const returnStoreId = request.returnStoreId ?? vehicle.storeId;
    this.requireStore(returnStoreId);
    const calendar = this.calendarOf(vehicle.id);
    calendar.assertFree(request.period);

    const terms: RentalTerms = {
      vehicle,
      period: request.period,
      pickupStoreId: vehicle.storeId,
      returnStoreId,
      extras: request.extras ?? [],
    };
    const reservation = new Reservation({
      ...terms,
      id: this.ids.next('RES'),
      customerId: request.customerId,
      estimate: this.pricing.price(terms, request.period.end),
    });
    calendar.book(reservation);
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  pickUp(reservationId: string): Reservation {
    const reservation = this.getReservation(reservationId);
    reservation.pickUp(this.clock.now());
    return reservation;
  }

  /** Prices against the real return time from the clock, so lateness is measured, never declared. */
  returnVehicle(reservationId: string): Invoice {
    const reservation = this.getReservation(reservationId);
    const returnedAt = this.clock.now();
    const invoice = this.pricing.price(reservation, returnedAt);
    reservation.complete(returnedAt, invoice);
    return invoice;
  }

  cancel(reservationId: string): Reservation {
    const reservation = this.getReservation(reservationId);
    reservation.cancel();
    return reservation;
  }

  getReservation(reservationId: string): Reservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new ReservationNotFoundError(reservationId);
    return reservation;
  }

  private requireStore(storeId: string): Store {
    const store = this.stores.get(storeId);
    if (!store) throw new StoreNotFoundError(storeId);
    return store;
  }

  private requireVehicle(vehicleId: string): Vehicle {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) throw new VehicleNotFoundError(vehicleId);
    return vehicle;
  }

  private calendarOf(vehicleId: string): VehicleCalendar {
    const calendar = this.calendars.get(vehicleId);
    if (!calendar) throw new VehicleNotFoundError(vehicleId);
    return calendar;
  }
}
