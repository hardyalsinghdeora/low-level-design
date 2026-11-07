import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import type { Driver } from './driver';
import { NoDriverAvailableError, NotFoundError, RiderHasActiveTripError } from './errors';
import { straightLineKm, type DistanceFn, type Location } from './geo';
import type { Rider } from './rider';
import { GracePeriodCancellation, type CancellationFeePolicy } from './strategies/cancellation';
import { FixedSurge, type FareStrategy, type SurgeProvider } from './strategies/fare';
import { NearestDriverMatching, type DriverMatchingStrategy } from './strategies/matching';
import { Party, Trip, TripStatus } from './trip';
import type { TripObserver } from './trip-events';

export interface RideSharingOptions {
  fare: FareStrategy;
  matching?: DriverMatchingStrategy;
  surge?: SurgeProvider;
  cancellation?: CancellationFeePolicy;
  distance?: DistanceFn;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Application service. It is the one place that moves a trip and its driver
 * together, so "driver ON_TRIP exactly while a trip is active" holds.
 */
export class RideSharingService {
  private readonly riders = new Map<string, Rider>();
  private readonly drivers = new Map<string, Driver>();
  private readonly trips = new Map<string, Trip>();
  private readonly observers: TripObserver[] = [];
  private readonly fareStrategy: FareStrategy;
  private matching: DriverMatchingStrategy;
  private readonly surge: SurgeProvider;
  private readonly cancellation: CancellationFeePolicy;
  private readonly distance: DistanceFn;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: RideSharingOptions) {
    this.fareStrategy = options.fare;
    this.matching = options.matching ?? new NearestDriverMatching();
    this.surge = options.surge ?? new FixedSurge();
    this.cancellation = options.cancellation ?? new GracePeriodCancellation(5_000);
    this.distance = options.distance ?? straightLineKm;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addRider(rider: Rider): this {
    this.riders.set(rider.id, rider);
    return this;
  }

  addDriver(driver: Driver): this {
    this.drivers.set(driver.id, driver);
    return this;
  }

  setMatchingStrategy(strategy: DriverMatchingStrategy): void {
    this.matching = strategy;
  }

  subscribe(observer: TripObserver): void {
    this.observers.push(observer);
  }

  /** Locks the surge, then tries to match at once; with nobody nearby the trip waits in REQUESTED. */
  requestTrip(riderId: string, pickup: Location, dropOff: Location): Trip {
    const rider = this.rider(riderId);
    if (rider.activeTripId) throw new RiderHasActiveTripError(riderId, rider.activeTripId);
    const now = this.clock.now();
    const surgePercent = this.surge.surgePercent({
      pickup,
      at: now,
      openRequests: this.countTrips(TripStatus.REQUESTED) + 1,
      onlineDrivers: [...this.drivers.values()].filter((d) => d.isAvailable).length,
    });
    const trip = new Trip(this.ids.next('TRIP'), riderId, pickup, dropOff, surgePercent, now);
    this.trips.set(trip.id, trip);
    rider.beginTrip(trip.id);
    this.publish(trip);
    const driver = this.matching.match([...this.drivers.values()], pickup, this.distance);
    if (driver) this.assign(trip, driver);
    return trip;
  }

  /** Called by a retry loop for trips still REQUESTED. */
  retryMatch(tripId: string): Driver {
    const trip = this.trip(tripId);
    trip.assertCanMoveTo(TripStatus.ACCEPTED);
    const driver = this.matching.match([...this.drivers.values()], trip.pickup, this.distance);
    if (!driver) throw new NoDriverAvailableError(tripId);
    this.assign(trip, driver);
    return driver;
  }

  startTrip(tripId: string, driverId: string): Trip {
    const trip = this.trip(tripId);
    trip.start(driverId, this.clock.now());
    this.publish(trip);
    return trip;
  }

  completeTrip(tripId: string, driverId: string): Trip {
    const trip = this.trip(tripId);
    trip.assertCanMoveTo(TripStatus.COMPLETED);
    const now = this.clock.now();
    const fare = this.fareStrategy.calculate({
      distanceKm: this.distance(trip.pickup, trip.dropOff),
      durationMinutes: trip.durationMinutes(now),
      surgePercent: trip.surgePercent,
    });
    trip.complete(driverId, now, fare);
    this.driver(driverId).release(trip.dropOff);
    this.rider(trip.riderId).endTrip();
    this.publish(trip);
    return trip;
  }

  cancelTrip(tripId: string, by: Party): Money {
    const trip = this.trip(tripId);
    const fee = this.cancellation.fee(trip, by, this.clock.now());
    trip.cancel(fee);
    if (trip.driverId) this.driver(trip.driverId).release();
    this.rider(trip.riderId).endTrip();
    this.publish(trip);
    return fee;
  }

  rateDriver(tripId: string, stars: number): void {
    const trip = this.trip(tripId);
    trip.recordRating(Party.RIDER);
    this.driver(trip.driverId ?? '').ratings.add(stars);
  }

  rateRider(tripId: string, stars: number): void {
    const trip = this.trip(tripId);
    trip.recordRating(Party.DRIVER);
    this.rider(trip.riderId).ratings.add(stars);
  }

  trip(tripId: string): Trip {
    const trip = this.trips.get(tripId);
    if (!trip) throw new NotFoundError('trip', tripId);
    return trip;
  }

  driver(driverId: string): Driver {
    const driver = this.drivers.get(driverId);
    if (!driver) throw new NotFoundError('driver', driverId);
    return driver;
  }

  rider(riderId: string): Rider {
    const rider = this.riders.get(riderId);
    if (!rider) throw new NotFoundError('rider', riderId);
    return rider;
  }

  private assign(trip: Trip, driver: Driver): void {
    driver.assign(trip.id); // throws if another request took this driver first
    trip.accept(driver.id, this.clock.now());
    this.publish(trip);
  }

  private countTrips(status: TripStatus): number {
    return [...this.trips.values()].filter((t) => t.status === status).length;
  }

  private publish(trip: Trip): void {
    const event = { tripId: trip.id, riderId: trip.riderId, driverId: trip.driverId, status: trip.status, at: this.clock.now() };
    for (const observer of this.observers) observer.onTripEvent(event);
  }
}
