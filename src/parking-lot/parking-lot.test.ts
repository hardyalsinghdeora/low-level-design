import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  BestFitStrategy,
  Car,
  FlatRateFeeStrategy,
  HourlyRateFeeStrategy,
  Motorcycle,
  NearestFirstStrategy,
  NoSpotAvailableError,
  ParkingFloor,
  ParkingLot,
  ParkingSpot,
  SpotOccupiedError,
  SpotSize,
  TicketNotFoundError,
  TicketStatus,
  Truck,
  VehicleAlreadyParkedError,
  VehicleType,
} from './index';

const RATES = {
  [VehicleType.MOTORCYCLE]: 2_000,
  [VehicleType.CAR]: 5_000,
  [VehicleType.TRUCK]: 10_000,
};

function buildLot(options: { bestFit?: boolean } = {}) {
  const clock = new FakeClock('2026-03-01T09:00:00Z');
  const lot = new ParkingLot('Test Lot', {
    feeStrategy: new HourlyRateFeeStrategy(RATES),
    assignmentStrategy: options.bestFit ? new BestFitStrategy() : new NearestFirstStrategy(),
    clock,
    ids: new SequentialIdGenerator(),
  });
  lot
    .addFloor(
      new ParkingFloor(1)
        .addSpot(new ParkingSpot('F1-S1', SpotSize.SMALL, 1, 5))
        .addSpot(new ParkingSpot('F1-M1', SpotSize.MEDIUM, 1, 10))
        .addSpot(new ParkingSpot('F1-L1', SpotSize.LARGE, 1, 20)),
    )
    .addFloor(new ParkingFloor(2).addSpot(new ParkingSpot('F2-M1', SpotSize.MEDIUM, 2, 10)));
  return { lot, clock };
}

describe('ParkingSpot', () => {
  it('accepts a vehicle that fits and refuses one that does not', () => {
    const spot = new ParkingSpot('S', SpotSize.MEDIUM, 1);
    expect(spot.canFit(new Motorcycle('M'))).toBe(true);
    expect(spot.canFit(new Car('C'))).toBe(true);
    expect(spot.canFit(new Truck('T'))).toBe(false);
  });

  it('cannot be double booked', () => {
    const spot = new ParkingSpot('S', SpotSize.LARGE, 1);
    spot.park(new Car('C1'));
    expect(() => spot.park(new Car('C2'))).toThrow(SpotOccupiedError);
  });
});

describe('ParkingLot', () => {
  let lot: ParkingLot;
  let clock: FakeClock;

  beforeEach(() => {
    ({ lot, clock } = buildLot());
  });

  it('parks a car in the nearest fitting spot and issues a ticket', () => {
    const ticket = lot.park(new Car('KA-01-1234'));
    expect(ticket.id).toBe('TKT-1');
    expect(ticket.spot.id).toBe('F1-M1');
    expect(ticket.status).toBe(TicketStatus.ACTIVE);
    expect(ticket.entryTime.toISOString()).toBe('2026-03-01T09:00:00.000Z');
    expect(lot.activeTicketCount).toBe(1);
  });

  it('lets a smaller vehicle use a larger spot when the right size is full', () => {
    lot.park(new Motorcycle('M1'));
    const second = lot.park(new Motorcycle('M2'));
    expect(second.spot.id).toBe('F1-M1');
  });

  it('best-fit keeps large spots free for trucks', () => {
    ({ lot } = buildLot({ bestFit: true }));
    const car1 = lot.park(new Car('C1'));
    const car2 = lot.park(new Car('C2'));
    expect([car1.spot.id, car2.spot.id]).toEqual(['F1-M1', 'F2-M1']);
    expect(lot.park(new Truck('T1')).spot.id).toBe('F1-L1');
  });

  it('nearest-first fills the large spot on floor 1 before going upstairs', () => {
    lot.park(new Car('C1'));
    expect(lot.park(new Car('C2')).spot.id).toBe('F1-L1');
  });

  it('throws when the lot has no fitting spot', () => {
    lot.park(new Truck('T1'));
    expect(() => lot.park(new Truck('T2'))).toThrow(NoSpotAvailableError);
  });

  it('rejects parking the same plate twice', () => {
    lot.park(new Car('C1'));
    expect(() => lot.park(new Car('C1'))).toThrow(VehicleAlreadyParkedError);
  });

  it('charges per started hour with a one hour minimum and frees the spot', () => {
    const ticket = lot.park(new Car('C1'));
    clock.advanceMinutes(155); // 2h35m -> 3 billable hours
    const receipt = lot.unpark(ticket.id);

    expect(receipt.fee).toBe(3 * RATES.CAR);
    expect(receipt.durationMinutes).toBe(155);
    expect(ticket.status).toBe(TicketStatus.PAID);
    expect(ticket.spot.isAvailable).toBe(true);
    expect(lot.activeTicketCount).toBe(0);
    expect(lot.findActiveTicket('C1')).toBeUndefined();
  });

  it('applies the minimum charge to very short stays', () => {
    const ticket = lot.park(new Motorcycle('M1'));
    clock.advanceMinutes(5);
    expect(lot.unpark(ticket.id).fee).toBe(RATES.MOTORCYCLE);
  });

  it('supports swapping the fee strategy at runtime', () => {
    lot.setFeeStrategy(new FlatRateFeeStrategy(15_000));
    const ticket = lot.park(new Truck('T1'));
    clock.advanceHours(10);
    expect(lot.unpark(ticket.id).fee).toBe(15_000);
  });

  it('throws for an unknown or already closed ticket', () => {
    expect(() => lot.unpark('nope')).toThrow(TicketNotFoundError);
    const ticket = lot.park(new Car('C1'));
    lot.unpark(ticket.id);
    expect(() => lot.unpark(ticket.id)).toThrow(TicketNotFoundError);
  });

  it('reports availability per floor and size', () => {
    lot.park(new Car('C1'));
    const [floor1, floor2] = lot.availability();
    expect(floor1).toMatchObject({ floor: 1, totalAvailable: 2, totalSpots: 3 });
    expect(floor1.available[SpotSize.MEDIUM]).toBe(0);
    expect(floor2).toMatchObject({ floor: 2, totalAvailable: 1, totalSpots: 1 });
  });
});
