import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { NoSpotAvailableError, TicketNotFoundError, VehicleAlreadyParkedError } from './errors';
import type { ParkingFloor } from '../parking-lot/parking-floor';
import type { SpotSize } from './parking-spot';
import { ParkingTicket } from './parking-ticket';
import type { FeeStrategy } from './strategies/fee';
import { NearestFirstStrategy, type SpotAssignmentStrategy } from './strategies/spot-assignment';
import type { Vehicle } from './vehicle';

export interface Receipt {
  ticketId: string;
  licensePlate: string;
  spotId: string;
  entryTime: Date;
  exitTime: Date;
  durationMinutes: number;
  fee: Money;
}

export interface FloorAvailability {
  floor: number;
  available: Record<SpotSize, number>;
  totalAvailable: number;
  totalSpots: number;
}

export interface ParkingLotOptions {
  feeStrategy: FeeStrategy;
  assignmentStrategy?: SpotAssignmentStrategy;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root. Owns floors, hands out tickets, and is the only place that
 * mutates spot occupancy, which keeps the "no double booking" invariant in one
 * file.
 *
 * Interviewers often expect a Singleton here. We deliberately keep it a plain
 * class and create one instance at the composition root: it is just as
 * "single", and it stays testable and reusable for a chain of lots.
 */
export class ParkingLot {
  private readonly floors: ParkingFloor[] = [];
  private readonly activeTickets = new Map<string, ParkingTicket>();
  private readonly ticketIdByPlate = new Map<string, string>();
  private assignmentStrategy: SpotAssignmentStrategy;
  private feeStrategy: FeeStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(
    readonly name: string,
    options: ParkingLotOptions,
  ) {
    this.feeStrategy = options.feeStrategy;
    this.assignmentStrategy = options.assignmentStrategy ?? new NearestFirstStrategy();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addFloor(floor: ParkingFloor): this {
    if (this.floors.some((f) => f.number === floor.number)) {
      throw new RangeError(`Floor ${floor.number} already exists`);
    }
    this.floors.push(floor);
    this.floors.sort((a, b) => a.number - b.number);
    return this;
  }

  setAssignmentStrategy(strategy: SpotAssignmentStrategy): void {
    this.assignmentStrategy = strategy;
  }

  setFeeStrategy(strategy: FeeStrategy): void {
    this.feeStrategy = strategy;
  }

  /** Entry gate flow: find a spot, occupy it, issue a ticket. */
  park(vehicle: Vehicle): ParkingTicket {
    if (this.ticketIdByPlate.has(vehicle.licensePlate)) {
      throw new VehicleAlreadyParkedError(vehicle.licensePlate);
    }
    const spot = this.assignmentStrategy.findSpot(this.floors, vehicle);
    if (!spot) throw new NoSpotAvailableError(vehicle.licensePlate);

    // Compare-and-set: the spot refuses a second vehicle, which is the guard
    // that matters when several gates run concurrently (see problems/parking-lot.md).
    spot.park(vehicle);

    const ticket = new ParkingTicket(this.ids.next('TKT'), vehicle, spot, this.clock.now());
    this.activeTickets.set(ticket.id, ticket);
    this.ticketIdByPlate.set(vehicle.licensePlate, ticket.id);
    return ticket;
  }

  /** Exit gate flow: price the stay, close the ticket, free the spot. */
  unpark(ticketId: string): Receipt {
    const ticket = this.activeTickets.get(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);

    const exitTime = this.clock.now();
    const fee = this.feeStrategy.calculate(ticket, exitTime);
    ticket.close(exitTime, fee);
    ticket.spot.unpark();
    this.activeTickets.delete(ticketId);
    this.ticketIdByPlate.delete(ticket.vehicle.licensePlate);

    return {
      ticketId: ticket.id,
      licensePlate: ticket.vehicle.licensePlate,
      spotId: ticket.spot.id,
      entryTime: ticket.entryTime,
      exitTime,
      durationMinutes: ticket.durationMinutes(exitTime),
      fee,
    };
  }

  findActiveTicket(licensePlate: string): ParkingTicket | undefined {
    const id = this.ticketIdByPlate.get(licensePlate);
    return id ? this.activeTickets.get(id) : undefined;
  }

  get activeTicketCount(): number {
    return this.activeTickets.size;
  }

  /** What a display board at the entrance would show. */
  availability(): FloorAvailability[] {
    return this.floors.map((floor) => {
      const available = floor.availabilityBySize();
      return {
        floor: floor.number,
        available,
        totalAvailable: Object.values(available).reduce((sum, n) => sum + n, 0),
        totalSpots: floor.allSpots.length,
      };
    });
  }
}
