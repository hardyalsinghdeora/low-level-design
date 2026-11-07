import type { Money } from '../shared/money';
import { InvalidRatingError, InvalidTripTransitionError, NotAssignedDriverError } from './errors';
import type { Location } from './geo';
import type { FareBreakdown } from './strategies/fare';

export enum TripStatus {
  REQUESTED = 'REQUESTED',
  ACCEPTED = 'ACCEPTED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** Once the rider is in the car the trip can only finish; cancelling a started trip is not a thing. */
const ALLOWED_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  [TripStatus.REQUESTED]: [TripStatus.ACCEPTED, TripStatus.CANCELLED],
  [TripStatus.ACCEPTED]: [TripStatus.STARTED, TripStatus.CANCELLED],
  [TripStatus.STARTED]: [TripStatus.COMPLETED],
  [TripStatus.COMPLETED]: [],
  [TripStatus.CANCELLED]: [],
};

export enum Party {
  RIDER = 'RIDER',
  DRIVER = 'DRIVER',
}

/** One ride. Owns its timestamps (for fares and cancellation fees), its fare and the two ratings. */
export class Trip {
  private _status = TripStatus.REQUESTED;
  private _driverId: string | null = null;
  private _acceptedAt: Date | null = null;
  private _startedAt: Date | null = null;
  private _completedAt: Date | null = null;
  private _fare: FareBreakdown | null = null;
  private _cancellationFee: Money = 0;
  private readonly ratedBy = new Set<Party>();

  constructor(
    readonly id: string,
    readonly riderId: string,
    readonly pickup: Location,
    readonly dropOff: Location,
    /** Surge quoted when the rider requested; locked so the price does not move under them. */
    readonly surgePercent: number,
    readonly requestedAt: Date,
  ) {}

  get status(): TripStatus {
    return this._status;
  }

  get driverId(): string | null {
    return this._driverId;
  }

  get acceptedAt(): Date | null {
    return this._acceptedAt;
  }

  get fare(): FareBreakdown | null {
    return this._fare;
  }

  get cancellationFee(): Money {
    return this._cancellationFee;
  }

  get isActive(): boolean {
    return this._status !== TripStatus.COMPLETED && this._status !== TripStatus.CANCELLED;
  }

  accept(driverId: string, at: Date): void {
    this.moveTo(TripStatus.ACCEPTED);
    this._driverId = driverId;
    this._acceptedAt = at;
  }

  start(driverId: string, at: Date): void {
    this.assertDriver(driverId);
    this.moveTo(TripStatus.STARTED);
    this._startedAt = at;
  }

  complete(driverId: string, at: Date, fare: FareBreakdown): void {
    this.assertDriver(driverId);
    this.moveTo(TripStatus.COMPLETED);
    this._completedAt = at;
    this._fare = fare;
  }

  cancel(fee: Money): void {
    this.moveTo(TripStatus.CANCELLED);
    this._cancellationFee = fee;
  }

  /** Started minutes from pickup to `until` (or to completion); billed per started minute. */
  durationMinutes(until: Date | null = this._completedAt): number {
    if (!this._startedAt || !until) return 0;
    return Math.ceil((until.getTime() - this._startedAt.getTime()) / 60_000);
  }

  /** Each side rates the other once, and only after a completed trip. */
  recordRating(by: Party): void {
    if (this._status !== TripStatus.COMPLETED) throw new InvalidRatingError(`trip ${this.id} is ${this._status}`);
    if (this.ratedBy.has(by)) throw new InvalidRatingError(`${by} already rated trip ${this.id}`);
    this.ratedBy.add(by);
  }

  assertCanMoveTo(next: TripStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) throw new InvalidTripTransitionError(this.id, this._status, next);
  }

  private assertDriver(driverId: string): void {
    if (driverId !== this._driverId) throw new NotAssignedDriverError(this.id, driverId);
  }

  private moveTo(next: TripStatus): void {
    this.assertCanMoveTo(next);
    this._status = next;
  }
}
