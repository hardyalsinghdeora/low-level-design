import { PartnerUnavailableError } from './errors';
import type { Location } from './geo';

export enum PartnerStatus {
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
}

/**
 * A rider. Availability changes only through these methods, so a busy partner
 * can never be handed a second order or log off mid-delivery.
 */
export class DeliveryPartner {
  private _status = PartnerStatus.OFFLINE;
  private _location: Location;
  private _orderId: string | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    location: Location,
    /** 1.0 - 5.0, used by the rating-weighted dispatcher. */
    readonly rating = 4.5,
  ) {
    this._location = location;
  }

  get status(): PartnerStatus {
    return this._status;
  }

  get location(): Location {
    return this._location;
  }

  get currentOrderId(): string | null {
    return this._orderId;
  }

  get isAvailable(): boolean {
    return this._status === PartnerStatus.AVAILABLE;
  }

  goOnline(): void {
    if (this._status === PartnerStatus.BUSY) throw new PartnerUnavailableError(this.id, this._status);
    this._status = PartnerStatus.AVAILABLE;
  }

  goOffline(): void {
    if (this._status === PartnerStatus.BUSY) throw new PartnerUnavailableError(this.id, this._status);
    this._status = PartnerStatus.OFFLINE;
  }

  /** Compare-and-set: only an AVAILABLE partner can take an order. */
  assign(orderId: string): void {
    if (this._status !== PartnerStatus.AVAILABLE) throw new PartnerUnavailableError(this.id, this._status);
    this._status = PartnerStatus.BUSY;
    this._orderId = orderId;
  }

  release(at?: Location): void {
    this._status = PartnerStatus.AVAILABLE;
    this._orderId = null;
    if (at) this._location = at;
  }

  moveTo(location: Location): void {
    this._location = location;
  }
}
