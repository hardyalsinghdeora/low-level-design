/** Strategy: whether a late bid pushes the end time out. Soft close defeats last-second sniping. */
export interface SoftClosePolicy {
  /** End time after a bid accepted at `bidAt`; return `currentEnd` to leave it unchanged. */
  endTimeAfterBid(currentEnd: Date, bidAt: Date): Date;
}

/** eBay behaviour: the auction ends exactly when scheduled, however busy the last minute is. */
export class HardClose implements SoftClosePolicy {
  endTimeAfterBid(currentEnd: Date): Date {
    return currentEnd;
  }
}

/** A bid in the last `windowMinutes` moves the end to `extendMinutes` after that bid. */
export class SoftCloseWindow implements SoftClosePolicy {
  constructor(
    private readonly windowMinutes: number,
    private readonly extendMinutes: number = windowMinutes,
  ) {
    if (windowMinutes <= 0 || extendMinutes <= 0) throw new RangeError('window and extension must be positive');
  }

  endTimeAfterBid(currentEnd: Date, bidAt: Date): Date {
    const remainingMs = currentEnd.getTime() - bidAt.getTime();
    if (remainingMs > this.windowMinutes * 60_000) return currentEnd;
    return new Date(Math.max(currentEnd.getTime(), bidAt.getTime() + this.extendMinutes * 60_000));
  }
}
