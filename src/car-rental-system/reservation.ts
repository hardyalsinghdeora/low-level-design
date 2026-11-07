import type { DateRange } from './date-range';
import { InvalidReservationTransitionError, OutsidePickupWindowError } from './errors';
import type { Invoice } from './invoice';
import type { Vehicle } from './vehicle';

export enum ReservationStatus {
  RESERVED = 'RESERVED',
  PICKED_UP = 'PICKED_UP',
  RETURNED = 'RETURNED',
  CANCELLED = 'CANCELLED',
}

export enum RentalExtra {
  INSURANCE = 'INSURANCE',
  CHILD_SEAT = 'CHILD_SEAT',
}

/** The only legal moves. Anything else throws, so the lifecycle cannot be skipped or rewound. */
const ALLOWED_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  [ReservationStatus.RESERVED]: [ReservationStatus.PICKED_UP, ReservationStatus.CANCELLED],
  [ReservationStatus.PICKED_UP]: [ReservationStatus.RETURNED],
  [ReservationStatus.RETURNED]: [],
  [ReservationStatus.CANCELLED]: [],
};

/** Everything pricing needs. A Reservation satisfies it, and so does a quote built before booking. */
export interface RentalTerms {
  readonly vehicle: Vehicle;
  readonly period: DateRange;
  readonly pickupStoreId: string;
  readonly returnStoreId: string;
  readonly extras: readonly RentalExtra[];
}

export interface ReservationProps extends RentalTerms {
  id: string;
  customerId: string;
  /** The price quoted at booking time, assuming an on-time return. */
  estimate: Invoice;
}

/**
 * One customer's claim on one vehicle for one period. It owns its lifecycle and
 * the key hand-over, validating everything before touching the vehicle so a
 * failed pickup leaves both objects unchanged.
 */
export class Reservation implements RentalTerms {
  readonly id: string;
  readonly customerId: string;
  readonly vehicle: Vehicle;
  readonly period: DateRange;
  readonly pickupStoreId: string;
  readonly returnStoreId: string;
  readonly extras: readonly RentalExtra[];
  readonly estimate: Invoice;
  private _status = ReservationStatus.RESERVED;
  private _pickedUpAt: Date | null = null;
  private _returnedAt: Date | null = null;
  private _invoice: Invoice | null = null;

  constructor(props: ReservationProps) {
    this.id = props.id;
    this.customerId = props.customerId;
    this.vehicle = props.vehicle;
    this.period = props.period;
    this.pickupStoreId = props.pickupStoreId;
    this.returnStoreId = props.returnStoreId;
    this.extras = [...new Set(props.extras)];
    this.estimate = props.estimate;
  }

  get status(): ReservationStatus {
    return this._status;
  }

  get isOneWay(): boolean {
    return this.pickupStoreId !== this.returnStoreId;
  }

  /** RESERVED and PICKED_UP hold the car; RETURNED and CANCELLED release it for other bookings. */
  get holdsVehicle(): boolean {
    return this._status === ReservationStatus.RESERVED || this._status === ReservationStatus.PICKED_UP;
  }

  get pickedUpAt(): Date | null {
    return this._pickedUpAt;
  }

  get returnedAt(): Date | null {
    return this._returnedAt;
  }

  get invoice(): Invoice | null {
    return this._invoice;
  }

  /** Pickup is only allowed inside the booked period, so an early customer cannot take a car someone else holds. */
  pickUp(at: Date): void {
    this.assertCanMoveTo(ReservationStatus.PICKED_UP);
    if (!this.period.contains(at)) throw new OutsidePickupWindowError(this.id, at);
    this.vehicle.checkOut(this.id, this.pickupStoreId);
    this._status = ReservationStatus.PICKED_UP;
    this._pickedUpAt = at;
  }

  complete(at: Date, invoice: Invoice): void {
    this.assertCanMoveTo(ReservationStatus.RETURNED);
    this.vehicle.checkIn(this.id, this.returnStoreId);
    this._status = ReservationStatus.RETURNED;
    this._returnedAt = at;
    this._invoice = invoice;
  }

  cancel(): void {
    this.assertCanMoveTo(ReservationStatus.CANCELLED);
    this._status = ReservationStatus.CANCELLED;
  }

  private assertCanMoveTo(next: ReservationStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidReservationTransitionError(this.id, this._status, next);
    }
  }
}
