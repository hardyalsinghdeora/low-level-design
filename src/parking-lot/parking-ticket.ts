import type { Money } from '../shared/money';
import { TicketAlreadyClosedError } from './errors';
import type { ParkingSpot } from './parking-spot';
import type { Vehicle } from './vehicle';

export enum TicketStatus {
  ACTIVE = 'ACTIVE',
  PAID = 'PAID',
}

export class ParkingTicket {
  private _status = TicketStatus.ACTIVE;
  private _exitTime: Date | null = null;
  private _fee: Money | null = null;

  constructor(
    readonly id: string,
    readonly vehicle: Vehicle,
    readonly spot: ParkingSpot,
    readonly entryTime: Date,
  ) {}

  get status(): TicketStatus {
    return this._status;
  }

  get exitTime(): Date | null {
    return this._exitTime;
  }

  get fee(): Money | null {
    return this._fee;
  }

  /** Whole minutes between entry and `at`, rounded up. Never negative. */
  durationMinutes(at: Date): number {
    return Math.max(0, Math.ceil((at.getTime() - this.entryTime.getTime()) / 60_000));
  }

  /** Closes the ticket. A second call throws so a vehicle is never charged twice. */
  close(exitTime: Date, fee: Money): void {
    if (this._status === TicketStatus.PAID) throw new TicketAlreadyClosedError(this.id);
    if (exitTime.getTime() < this.entryTime.getTime()) {
      throw new RangeError(`exitTime ${exitTime.toISOString()} is before entry ${this.entryTime.toISOString()}`);
    }
    this._exitTime = exitTime;
    this._fee = fee;
    this._status = TicketStatus.PAID;
  }
}
