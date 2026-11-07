import { addDays } from '../billing-calendar';

/** When to retry a failed invoice payment, measured from the first failure. `undefined` means give up. */
export interface RetrySchedule {
  nextAttemptAt(firstFailedAt: Date, failedAttempts: number): Date | undefined;
}

/** Retries at fixed day offsets after the first failure; +1, +3, +7 days by default. */
export class FixedDaysRetrySchedule implements RetrySchedule {
  constructor(private readonly offsetsInDays: readonly number[] = [1, 3, 7]) {}

  nextAttemptAt(firstFailedAt: Date, failedAttempts: number): Date | undefined {
    const offset = this.offsetsInDays[failedAttempts - 1];
    return offset === undefined ? undefined : addDays(firstFailedAt, offset);
  }
}
