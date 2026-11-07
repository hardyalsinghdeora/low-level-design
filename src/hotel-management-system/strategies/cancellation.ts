import type { Money } from '../../shared/money';
import type { Reservation } from '../reservation';
import { dayNumberOf } from '../stay-dates';

/** Strategy: what a guest owes for cancelling. Kept apart from the state machine on purpose. */
export interface CancellationPolicy {
  fee(reservation: Reservation, cancelledAt: Date): Money;
}

/** Free if cancelled at least `freeDays` calendar days before check-in, otherwise the first night is charged. */
export class FreeUntilDaysBeforePolicy implements CancellationPolicy {
  constructor(private readonly freeDays: number) {}

  fee(reservation: Reservation, cancelledAt: Date): Money {
    const daysBefore = reservation.dates.startDay - dayNumberOf(cancelledAt);
    if (daysBefore >= this.freeDays) return 0;
    return reservation.nightlyCharges[0]?.amount ?? 0;
  }
}

/** Discounted rates that cannot be refunded: the whole room total is kept. */
export class NonRefundablePolicy implements CancellationPolicy {
  fee(reservation: Reservation): Money {
    return reservation.roomTotal;
  }
}
