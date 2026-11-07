import { DriverUnavailableError } from './errors';
import type { Location } from './geo';
import { RatingSummary } from './rating';

export enum DriverStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ON_TRIP = 'ON_TRIP',
}

/**
 * A driver and their availability. The status changes only through these
 * methods, so a driver on a trip can never be matched again or log off.
 */
export class Driver {
  readonly ratings = new RatingSummary();
  private _status = DriverStatus.OFFLINE;
  private _tripId: string | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    public location: Location,
    readonly vehicle: string,
  ) {}

  get status(): DriverStatus {
    return this._status;
  }

  get currentTripId(): string | null {
    return this._tripId;
  }

  get isAvailable(): boolean {
    return this._status === DriverStatus.ONLINE;
  }

  goOnline(): void {
    if (this._status === DriverStatus.ON_TRIP) throw new DriverUnavailableError(this.id, this._status);
    this._status = DriverStatus.ONLINE;
  }

  goOffline(): void {
    if (this._status === DriverStatus.ON_TRIP) throw new DriverUnavailableError(this.id, this._status);
    this._status = DriverStatus.OFFLINE;
  }

  /** Compare-and-set: only an ONLINE driver can be put on a trip. */
  assign(tripId: string): void {
    if (this._status !== DriverStatus.ONLINE) throw new DriverUnavailableError(this.id, this._status);
    this._status = DriverStatus.ON_TRIP;
    this._tripId = tripId;
  }

  release(at?: Location): void {
    this._status = DriverStatus.ONLINE;
    this._tripId = null;
    if (at) this.location = at;
  }
}
