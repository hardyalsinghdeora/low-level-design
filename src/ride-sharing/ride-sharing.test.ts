import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  DemandBasedSurge,
  Driver,
  DriverStatus,
  DriverUnavailableError,
  FixedSurge,
  HighestRatedMatching,
  InvalidRatingError,
  InvalidTripTransitionError,
  NearestDriverMatching,
  NoDriverAvailableError,
  NotAssignedDriverError,
  Party,
  RideSharingService,
  Rider,
  RiderHasActiveTripError,
  StandardFare,
  type SurgeProvider,
  TripStatus,
  TripTimeline,
} from './index';

const RATES = { base: 5_000, perKm: 1_200, perMinute: 200, minimum: 8_000 };
const PICKUP = { x: 0, y: 0 };
const DROP = { x: 6, y: 8 }; // 10 km

function setup(options: { surge?: SurgeProvider; matching?: NearestDriverMatching | HighestRatedMatching } = {}) {
  const clock = new FakeClock('2026-08-01T08:00:00Z');
  const timeline = new TripTimeline();
  const service = new RideSharingService({
    fare: new StandardFare(RATES),
    surge: options.surge,
    matching: options.matching,
    clock,
    ids: new SequentialIdGenerator(),
  });
  service.subscribe(timeline);
  const drivers = [
    new Driver('D1', 'Arun', { x: 1, y: 0 }, 'KA-01-1111'),
    new Driver('D2', 'Bhavna', { x: 2, y: 0 }, 'KA-01-2222'),
    new Driver('D3', 'Chetan', { x: 0.5, y: 0 }, 'KA-01-3333'),
  ];
  for (const d of drivers) service.addDriver(d);
  drivers[0].goOnline();
  drivers[1].goOnline(); // D3 stays offline
  for (const id of ['r1', 'r2', 'r3']) service.addRider(new Rider(id, id.toUpperCase(), PICKUP));
  return { clock, service, drivers, timeline };
}

function ride(service: RideSharingService, clock: FakeClock, riderId = 'r1', minutes = 25) {
  const trip = service.requestTrip(riderId, PICKUP, DROP);
  const driverId = trip.driverId ?? '';
  service.startTrip(trip.id, driverId);
  clock.advanceMinutes(minutes);
  return service.completeTrip(trip.id, driverId);
}

describe('matching', () => {
  it('matches the nearest online driver and marks them ON_TRIP', () => {
    const { service, drivers } = setup();
    const trip = service.requestTrip('r1', PICKUP, DROP);
    expect(trip).toMatchObject({ status: TripStatus.ACCEPTED, driverId: 'D1' }); // D3 is nearer but offline
    expect(drivers[0].status).toBe(DriverStatus.ON_TRIP);
    expect(service.requestTrip('r2', PICKUP, DROP).driverId).toBe('D2');
  });

  it('leaves the trip REQUESTED when nobody is in the radius, and retries later', () => {
    const { service, drivers } = setup({ matching: new NearestDriverMatching(0.8) });
    const trip = service.requestTrip('r1', PICKUP, DROP);
    expect(trip.status).toBe(TripStatus.REQUESTED);
    expect(() => service.retryMatch(trip.id)).toThrow(NoDriverAvailableError);
    drivers[2].goOnline();
    expect(service.retryMatch(trip.id).id).toBe('D3');
    expect(() => service.retryMatch(trip.id)).toThrow(InvalidTripTransitionError);
  });

  it('highest-rated matching prefers the better driver inside the radius', () => {
    const { service, drivers, clock } = setup();
    ride(service, clock, 'r1'); // D1
    service.rateDriver('TRIP-1', 3);
    drivers[1].ratings.add(5);
    drivers[0].location = PICKUP;
    service.setMatchingStrategy(new HighestRatedMatching(5));
    expect(service.requestTrip('r2', PICKUP, DROP).driverId).toBe('D2');
  });
});

describe('fares', () => {
  it('charges base + per km + per started minute, with a minimum fare', () => {
    const { service, clock } = setup();
    const trip = ride(service, clock, 'r1', 25);
    expect(trip.fare).toEqual({ base: 5_000, distanceCharge: 12_000, timeCharge: 5_000, surgePercent: 100, total: 22_000 });
    expect(new StandardFare(RATES).calculate({ distanceKm: 0.4, durationMinutes: 2, surgePercent: 100 }).total).toBe(8_000);
  });

  it('applies the surge locked at request time, rounded up', () => {
    let surge = 150;
    const { service, clock } = setup({ surge: { surgePercent: () => surge } });
    const trip = service.requestTrip('r1', PICKUP, DROP);
    surge = 300; // demand spikes mid-trip; the rider keeps the quoted multiplier
    service.startTrip(trip.id, 'D1');
    clock.advanceSeconds(24 * 60 + 1); // 25 started minutes
    expect(service.completeTrip(trip.id, 'D1').fare?.total).toBe(33_000);
    expect(new StandardFare(RATES).calculate({ distanceKm: 3.333, durationMinutes: 7, surgePercent: 115 }).total).toBe(11_960); // (5,000 + 4,000 + 1,400) x 1.15
  });

  it('derives surge from demand and supply', () => {
    const surge = new DemandBasedSurge(200);
    const at = new Date();
    expect(surge.surgePercent({ pickup: PICKUP, at, openRequests: 2, onlineDrivers: 3 })).toBe(100);
    expect(surge.surgePercent({ pickup: PICKUP, at, openRequests: 4, onlineDrivers: 3 })).toBe(140);
    expect(surge.surgePercent({ pickup: PICKUP, at, openRequests: 9, onlineDrivers: 0 })).toBe(200);
    expect(new FixedSurge().surgePercent()).toBe(100);
  });
});

describe('lifecycle and cancellation', () => {
  it('cancels free within 2 minutes of acceptance and charges after', () => {
    const { service, clock, drivers } = setup();
    const quick = service.requestTrip('r1', PICKUP, DROP);
    clock.advanceSeconds(120);
    expect(service.cancelTrip(quick.id, Party.RIDER)).toBe(0);
    expect(drivers[0].status).toBe(DriverStatus.ONLINE);

    const late = service.requestTrip('r1', PICKUP, DROP);
    clock.advanceSeconds(121);
    expect(service.cancelTrip(late.id, Party.RIDER)).toBe(5_000);

    const byDriver = service.requestTrip('r1', PICKUP, DROP);
    clock.advanceMinutes(10);
    expect(service.cancelTrip(byDriver.id, Party.DRIVER)).toBe(0);
  });

  it('rejects invalid transitions and the wrong driver', () => {
    const { service } = setup();
    const trip = service.requestTrip('r1', PICKUP, DROP);
    expect(() => service.completeTrip(trip.id, 'D1')).toThrow(InvalidTripTransitionError);
    expect(() => service.startTrip(trip.id, 'D2')).toThrow(NotAssignedDriverError);
    service.startTrip(trip.id, 'D1');
    expect(() => service.cancelTrip(trip.id, Party.RIDER)).toThrow(InvalidTripTransitionError);
    expect(() => service.requestTrip('r1', PICKUP, DROP)).toThrow(RiderHasActiveTripError);
  });

  it('toggles availability: no logging off on a trip, back ONLINE at the drop-off after', () => {
    const { service, clock, drivers, timeline } = setup();
    const trip = service.requestTrip('r1', PICKUP, DROP);
    expect(() => drivers[0].goOffline()).toThrow(DriverUnavailableError);
    expect(() => drivers[2].assign('TRIP-X')).toThrow(DriverUnavailableError);
    service.startTrip(trip.id, 'D1');
    clock.advanceMinutes(20);
    service.completeTrip(trip.id, 'D1');
    expect(drivers[0]).toMatchObject({ status: DriverStatus.ONLINE, location: DROP, currentTripId: null });
    drivers[0].goOffline();
    expect(drivers[0].status).toBe(DriverStatus.OFFLINE);
    expect(timeline.of(trip.id)).toEqual(['REQUESTED', 'ACCEPTED', 'STARTED', 'COMPLETED']);
  });
});

describe('ratings', () => {
  it('rates both ways once each, only after completion', () => {
    const { service, clock, drivers } = setup();
    const pending = service.requestTrip('r2', PICKUP, DROP);
    expect(() => service.rateDriver(pending.id, 5)).toThrow(InvalidRatingError);

    const done = ride(service, clock, 'r1');
    service.rateDriver(done.id, 4);
    service.rateRider(done.id, 5);
    expect(() => service.rateDriver(done.id, 5)).toThrow(InvalidRatingError);
    const driver = service.driver(done.driverId ?? '');
    expect(driver.id).toBe('D2'); // D1 is still on r2's pending trip
    expect([driver.ratings.average, driver.ratings.count]).toEqual([4, 1]);
    expect(drivers[0].ratings.average).toBe(5); // unrated drivers sit at the prior
    expect(service.rider('r1').ratings.count).toBe(1);
    expect(() => drivers[0].ratings.add(6)).toThrow(InvalidRatingError);
  });
});
