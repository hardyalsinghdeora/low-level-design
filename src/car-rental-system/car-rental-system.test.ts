import { beforeEach, describe, expect, it } from 'vitest';
import type { PricingStrategy } from './strategies/pricing';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  CarRentalSystem,
  CategorySpec,
  DateRange,
  InvalidRentalPeriodError,
  InvalidReservationTransitionError,
  LineItemKind,
  LongRentalDiscount,
  MaxDailyRateSpec,
  OutsidePickupWindowError,
  RentalExtra,
  ReservationNotFoundError,
  ReservationStatus,
  StandardPricingStrategy,
  Store,
  StoreNotFoundError,
  StoreSpec,
  Transmission,
  TransmissionSpec,
  Vehicle,
  VehicleCategory,
  VehicleNotAtStoreError,
  VehicleNotFoundError,
  VehicleUnavailableError,
} from './index';

const pricing = new StandardPricingStrategy({
  extraDailyRates: { [RentalExtra.INSURANCE]: 50_000, [RentalExtra.CHILD_SEAT]: 20_000 },
  lateFeePerHour: 30_000,
  graceMinutes: 30,
  oneWayFee: 150_000,
});

const range = (start: string, end: string) => new DateRange(start, end);
const MAR_3_TO_5 = () => range('2026-03-03T10:00:00Z', '2026-03-05T10:00:00Z');

function buildSystem(pricingStrategy: PricingStrategy = pricing) {
  const clock = new FakeClock('2026-03-02T09:00:00Z');
  const system = new CarRentalSystem({ pricing: pricingStrategy, clock, ids: new SequentialIdGenerator() });
  system
    .addStore(new Store('AIR', 'Airport', 'Bengaluru'))
    .addStore(new Store('CITY', 'City Centre', 'Bengaluru'))
    .addStore(new Store('MYS', 'Mysuru', 'Mysuru'));
  const car = (id: string, model: string, category: VehicleCategory, transmission: Transmission, dailyRate: number, storeId: string) =>
    new Vehicle({ id, model, category, transmission, dailyRate, storeId });
  system
    .addVehicle(car('ECO-1', 'Swift', VehicleCategory.ECONOMY, Transmission.MANUAL, 180_000, 'AIR'))
    .addVehicle(car('ECO-2', 'Baleno', VehicleCategory.ECONOMY, Transmission.AUTOMATIC, 220_000, 'AIR'))
    .addVehicle(car('SUV-1', 'Creta', VehicleCategory.SUV, Transmission.AUTOMATIC, 350_000, 'AIR'))
    .addVehicle(car('LUX-1', 'BMW 5', VehicleCategory.LUXURY, Transmission.AUTOMATIC, 1_200_000, 'CITY'));
  return { system, clock };
}

const ids = (vehicles: Vehicle[]) => vehicles.map((v) => v.id);

describe('DateRange', () => {
  it('is half-open, so back-to-back rentals do not overlap', () => {
    const first = MAR_3_TO_5();
    expect(first.overlaps(range('2026-03-05T10:00:00Z', '2026-03-06T10:00:00Z'))).toBe(false);
    expect(first.overlaps(range('2026-03-04T10:00:00Z', '2026-03-06T10:00:00Z'))).toBe(true);
    expect(first.billableDays).toBe(2);
    expect(range('2026-03-03T10:00:00Z', '2026-03-05T10:01:00Z').billableDays).toBe(3);
    expect(() => range('2026-03-05T10:00:00Z', '2026-03-03T10:00:00Z')).toThrow(InvalidRentalPeriodError);
  });
});

describe('CarRentalSystem', () => {
  let system: CarRentalSystem;
  let clock: FakeClock;

  beforeEach(() => {
    ({ system, clock } = buildSystem());
  });

  it('composes search filters with and / or / not', () => {
    const automaticAtAirportUnder4k = new TransmissionSpec(Transmission.AUTOMATIC)
      .and(new StoreSpec('AIR'))
      .and(new MaxDailyRateSpec(400_000));
    expect(ids(system.search(MAR_3_TO_5(), automaticAtAirportUnder4k))).toEqual(['ECO-2', 'SUV-1']);

    const bigCars = new CategorySpec(VehicleCategory.SUV).or(new CategorySpec(VehicleCategory.LUXURY));
    expect(ids(system.search(MAR_3_TO_5(), bigCars))).toEqual(['SUV-1', 'LUX-1']);
    expect(ids(system.search(MAR_3_TO_5(), new CategorySpec(VehicleCategory.ECONOMY).not()))).toEqual(['SUV-1', 'LUX-1']);
  });

  it('hides vehicles that are booked for an overlapping period', () => {
    system.reserve({ customerId: 'asha', vehicleId: 'SUV-1', period: MAR_3_TO_5() });
    const suvs = new CategorySpec(VehicleCategory.SUV);
    expect(system.search(range('2026-03-04T10:00:00Z', '2026-03-06T10:00:00Z'), suvs)).toEqual([]);
    expect(ids(system.search(range('2026-03-05T10:00:00Z', '2026-03-06T10:00:00Z'), suvs))).toEqual(['SUV-1']);
  });

  it('never double-books a vehicle, and cancelling frees the slot', () => {
    const first = system.reserve({ customerId: 'asha', vehicleId: 'SUV-1', period: MAR_3_TO_5() });
    const overlapping = { customerId: 'ravi', vehicleId: 'SUV-1', period: range('2026-03-04T10:00:00Z', '2026-03-06T10:00:00Z') };
    expect(() => system.reserve(overlapping)).toThrow(VehicleUnavailableError);

    system.cancel(first.id);
    expect(first.status).toBe(ReservationStatus.CANCELLED);
    expect(system.reserve(overlapping).status).toBe(ReservationStatus.RESERVED);
  });

  it('rejects pickup times in the past', () => {
    const past = range('2026-03-01T10:00:00Z', '2026-03-04T10:00:00Z');
    expect(() => system.reserve({ customerId: 'asha', vehicleId: 'ECO-1', period: past })).toThrow(InvalidRentalPeriodError);
  });

  it('quotes extras as line items and bills an on-time return like the quote', () => {
    const extras = [RentalExtra.INSURANCE, RentalExtra.CHILD_SEAT];
    const reservation = system.reserve({ customerId: 'asha', vehicleId: 'SUV-1', period: MAR_3_TO_5(), extras });
    expect(reservation.estimate.lines.map((l) => [l.kind, l.amount])).toEqual([
      [LineItemKind.RENTAL, 700_000],
      [LineItemKind.EXTRA, 100_000],
      [LineItemKind.EXTRA, 40_000],
    ]);

    clock.set('2026-03-03T10:15:00Z');
    system.pickUp(reservation.id);
    expect(reservation.vehicle.isOnRent).toBe(true);

    clock.set('2026-03-05T10:20:00Z'); // inside the 30 minute grace period
    const invoice = system.returnVehicle(reservation.id);
    expect(invoice.total).toBe(reservation.estimate.total);
    expect(reservation.status).toBe(ReservationStatus.RETURNED);
    expect(reservation.vehicle.isOnRent).toBe(false);
  });

  it('charges late hours from the clock, and an overdue car blocks the next pickup', () => {
    const first = system.reserve({ customerId: 'asha', vehicleId: 'SUV-1', period: MAR_3_TO_5() });
    const next = system.reserve({ customerId: 'ravi', vehicleId: 'SUV-1', period: range('2026-03-05T10:00:00Z', '2026-03-06T10:00:00Z') });
    clock.set('2026-03-03T10:00:00Z');
    system.pickUp(first.id);

    clock.set('2026-03-05T11:00:00Z');
    expect(() => system.pickUp(next.id)).toThrow(VehicleUnavailableError);

    clock.set('2026-03-05T12:40:00Z'); // 2h40m late -> 3 started hours
    const invoice = system.returnVehicle(first.id);
    expect(invoice.amountOf(LineItemKind.LATE_FEE)).toBe(3 * 30_000);
    expect(invoice.total).toBe(700_000 + 90_000);
    expect(system.pickUp(next.id).status).toBe(ReservationStatus.PICKED_UP);
  });

  it('one-way rentals add a drop fee and move the car to the return store', () => {
    const oneWay = system.reserve({ customerId: 'asha', vehicleId: 'ECO-2', period: MAR_3_TO_5(), returnStoreId: 'MYS' });
    const later = system.reserve({ customerId: 'ravi', vehicleId: 'ECO-2', period: range('2026-03-06T10:00:00Z', '2026-03-07T10:00:00Z') });
    expect(oneWay.isOneWay).toBe(true);

    clock.set('2026-03-03T10:00:00Z');
    system.pickUp(oneWay.id);
    clock.set('2026-03-05T09:00:00Z');
    const invoice = system.returnVehicle(oneWay.id);

    expect(invoice.amountOf(LineItemKind.ONE_WAY_FEE)).toBe(150_000);
    expect(oneWay.vehicle.storeId).toBe('MYS');
    const week2 = range('2026-03-10T10:00:00Z', '2026-03-11T10:00:00Z');
    expect(ids(system.search(week2, new StoreSpec('MYS')))).toEqual(['ECO-2']);

    clock.set('2026-03-06T10:00:00Z');
    expect(() => system.pickUp(later.id)).toThrow(VehicleNotAtStoreError);
  });

  it('enforces the reservation state machine', () => {
    const reservation = system.reserve({ customerId: 'asha', vehicleId: 'ECO-1', period: MAR_3_TO_5() });
    const cancelled = system.cancel(system.reserve({ customerId: 'ravi', vehicleId: 'ECO-2', period: MAR_3_TO_5() }).id);
    expect(() => system.returnVehicle(reservation.id)).toThrow(InvalidReservationTransitionError);

    clock.set('2026-03-03T11:00:00Z');
    system.pickUp(reservation.id);
    expect(() => system.pickUp(reservation.id)).toThrow(InvalidReservationTransitionError);
    expect(() => system.cancel(reservation.id)).toThrow(InvalidReservationTransitionError);
    expect(() => system.pickUp(cancelled.id)).toThrow(InvalidReservationTransitionError);
  });

  it('only hands over keys inside the booked window', () => {
    const reservation = system.reserve({ customerId: 'asha', vehicleId: 'ECO-1', period: MAR_3_TO_5() });
    clock.set('2026-03-03T09:59:00Z');
    expect(() => system.pickUp(reservation.id)).toThrow(OutsidePickupWindowError);
    expect(reservation.status).toBe(ReservationStatus.RESERVED);
    expect(reservation.vehicle.isOnRent).toBe(false);
  });

  it('reports unknown vehicles, stores and reservations', () => {
    expect(() => system.reserve({ customerId: 'a', vehicleId: 'NOPE', period: MAR_3_TO_5() })).toThrow(VehicleNotFoundError);
    expect(() => system.reserve({ customerId: 'a', vehicleId: 'ECO-1', period: MAR_3_TO_5(), returnStoreId: 'GOA' })).toThrow(
      StoreNotFoundError,
    );
    expect(() => system.pickUp('RES-404')).toThrow(ReservationNotFoundError);
  });

  it('long-rental discount decorates any pricing strategy', () => {
    ({ system } = buildSystem(new LongRentalDiscount(pricing, 7, 10)));
    const week = system.reserve({ customerId: 'asha', vehicleId: 'ECO-1', period: range('2026-03-03T10:00:00Z', '2026-03-11T10:00:00Z') });
    expect(week.estimate.amountOf(LineItemKind.RENTAL)).toBe(8 * 180_000);
    expect(week.estimate.amountOf(LineItemKind.DISCOUNT)).toBe(-144_000);
    expect(week.estimate.total).toBe(1_296_000);

    const short = system.reserve({ customerId: 'ravi', vehicleId: 'ECO-2', period: MAR_3_TO_5() });
    expect(short.estimate.amountOf(LineItemKind.DISCOUNT)).toBe(0);
  });
});
