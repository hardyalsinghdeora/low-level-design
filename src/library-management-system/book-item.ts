import { CopyNotAvailableError, InvalidTransitionError } from './errors';

export enum CopyStatus {
  AVAILABLE = 'AVAILABLE',
  LOANED = 'LOANED',
  ON_HOLD = 'ON_HOLD',
  LOST = 'LOST',
}

export enum CopyAction {
  CHECK_OUT = 'CHECK_OUT',
  CHECK_IN = 'CHECK_IN',
  HOLD = 'HOLD',
  RELEASE_HOLD = 'RELEASE_HOLD',
  REPORT_LOST = 'REPORT_LOST',
  FIND = 'FIND',
}

/** State machine as a table: the statuses each action may start from, and where it leads. */
export const COPY_TRANSITIONS: Record<CopyAction, { from: readonly CopyStatus[]; to: CopyStatus }> = {
  [CopyAction.CHECK_OUT]: { from: [CopyStatus.AVAILABLE, CopyStatus.ON_HOLD], to: CopyStatus.LOANED },
  [CopyAction.CHECK_IN]: { from: [CopyStatus.LOANED], to: CopyStatus.AVAILABLE },
  [CopyAction.HOLD]: { from: [CopyStatus.AVAILABLE], to: CopyStatus.ON_HOLD },
  [CopyAction.RELEASE_HOLD]: { from: [CopyStatus.ON_HOLD], to: CopyStatus.AVAILABLE },
  [CopyAction.REPORT_LOST]: { from: [CopyStatus.AVAILABLE, CopyStatus.LOANED, CopyStatus.ON_HOLD], to: CopyStatus.LOST },
  [CopyAction.FIND]: { from: [CopyStatus.LOST], to: CopyStatus.AVAILABLE },
};

/**
 * One physical copy with its own barcode and lifecycle. Every status change
 * goes through the transition table, so an impossible move (lending a LOST
 * copy, checking in a copy that is on the shelf) throws instead of corrupting
 * the shelf.
 */
export class BookItem {
  private _status = CopyStatus.AVAILABLE;
  private _heldFor: string | null = null;

  constructor(
    readonly barcode: string,
    readonly isbn: string,
  ) {}

  get status(): CopyStatus {
    return this._status;
  }

  /** The member an ON_HOLD copy is reserved for. */
  get heldFor(): string | null {
    return this._heldFor;
  }

  isLendableTo(memberId: string): boolean {
    return this._status === CopyStatus.AVAILABLE || (this._status === CopyStatus.ON_HOLD && this._heldFor === memberId);
  }

  /** Lending has one rule the table cannot express: a held copy goes only to its holder. */
  checkOut(memberId: string): void {
    if (!this.isLendableTo(memberId)) throw new CopyNotAvailableError(this.barcode, this._status);
    this.apply(CopyAction.CHECK_OUT);
  }

  checkIn(): void {
    this.apply(CopyAction.CHECK_IN);
  }

  holdFor(memberId: string): void {
    this.apply(CopyAction.HOLD);
    this._heldFor = memberId;
  }

  releaseHold(): void {
    this.apply(CopyAction.RELEASE_HOLD);
  }

  reportLost(): void {
    this.apply(CopyAction.REPORT_LOST);
  }

  markFound(): void {
    this.apply(CopyAction.FIND);
  }

  private apply(action: CopyAction): void {
    const transition = COPY_TRANSITIONS[action];
    if (!transition.from.includes(this._status)) {
      throw new InvalidTransitionError('Copy', this.barcode, this._status, action);
    }
    this._status = transition.to;
    this._heldFor = null;
  }
}
