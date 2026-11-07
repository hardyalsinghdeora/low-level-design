import { DuplicateHoldError, InvalidTransitionError } from './errors';

export enum HoldStatus {
  WAITING = 'WAITING',
  OFFERED = 'OFFERED',
  FULFILLED = 'FULFILLED',
  EXPIRED = 'EXPIRED',
}

const HOLD_TRANSITIONS: Record<HoldStatus, readonly HoldStatus[]> = {
  [HoldStatus.WAITING]: [HoldStatus.OFFERED],
  [HoldStatus.OFFERED]: [HoldStatus.FULFILLED, HoldStatus.EXPIRED],
  [HoldStatus.FULFILLED]: [],
  [HoldStatus.EXPIRED]: [],
};

/** A member's place in line for a title. It is offered a specific copy only when one comes back. */
export class Hold {
  private _status = HoldStatus.WAITING;
  private _offeredBarcode: string | null = null;
  private _offerExpiresAt: Date | null = null;

  constructor(
    readonly id: string,
    readonly isbn: string,
    readonly memberId: string,
    readonly placedAt: Date,
  ) {}

  get status(): HoldStatus {
    return this._status;
  }

  get offeredBarcode(): string | null {
    return this._offeredBarcode;
  }

  get offerExpiresAt(): Date | null {
    return this._offerExpiresAt;
  }

  get isActive(): boolean {
    return this._status === HoldStatus.WAITING || this._status === HoldStatus.OFFERED;
  }

  offer(barcode: string, expiresAt: Date): void {
    this.moveTo(HoldStatus.OFFERED);
    this._offeredBarcode = barcode;
    this._offerExpiresAt = expiresAt;
  }

  fulfil(): void {
    this.moveTo(HoldStatus.FULFILLED);
  }

  expire(): void {
    this.moveTo(HoldStatus.EXPIRED);
  }

  isOfferExpired(now: Date): boolean {
    return this._status === HoldStatus.OFFERED && this._offerExpiresAt !== null && this._offerExpiresAt <= now;
  }

  private moveTo(next: HoldStatus): void {
    if (!HOLD_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidTransitionError('Hold', this.id, this._status, `move to ${next}`);
    }
    this._status = next;
  }
}

/**
 * First-come, first-served line for one title. It enforces "one active hold
 * per member per title" and always answers with the oldest waiting hold.
 */
export class HoldQueue {
  private readonly holds: Hold[] = [];

  constructor(readonly isbn: string) {}

  add(hold: Hold): void {
    if (this.activeFor(hold.memberId)) throw new DuplicateHoldError(hold.memberId, this.isbn);
    this.holds.push(hold);
  }

  activeFor(memberId: string): Hold | undefined {
    return this.holds.find((hold) => hold.memberId === memberId && hold.isActive);
  }

  nextWaiting(): Hold | undefined {
    return this.holds.find((hold) => hold.status === HoldStatus.WAITING);
  }

  get waitingCount(): number {
    return this.holds.filter((hold) => hold.status === HoldStatus.WAITING).length;
  }

  expiredOffers(now: Date): Hold[] {
    return this.holds.filter((hold) => hold.isOfferExpired(now));
  }
}
