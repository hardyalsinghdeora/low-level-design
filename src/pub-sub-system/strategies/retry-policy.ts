import { assertPositiveInteger } from '../errors';

/** Strategy pattern: how many times to try a message and how long to wait between tries. */
export interface RetryPolicy {
  /** Total deliveries allowed, the first one included. */
  readonly maxAttempts: number;
  /** Delay before the next delivery after `attempt` failed (1-based). */
  delayMs(attempt: number): number;
}

export class FixedDelayRetryPolicy implements RetryPolicy {
  constructor(
    readonly maxAttempts = 3,
    private readonly delay = 1_000,
  ) {
    assertPositiveInteger('maxAttempts', maxAttempts);
  }

  delayMs(): number {
    return this.delay;
  }
}

/** base, 2*base, 4*base ... capped. Production code adds jitter from an injected rng to avoid retry storms. */
export class ExponentialBackoffRetryPolicy implements RetryPolicy {
  constructor(
    readonly maxAttempts = 5,
    private readonly baseMs = 1_000,
    private readonly maxDelayMs = 60_000,
  ) {
    assertPositiveInteger('maxAttempts', maxAttempts);
    assertPositiveInteger('baseMs', baseMs);
  }

  delayMs(attempt: number): number {
    return Math.min(this.maxDelayMs, this.baseMs * 2 ** (attempt - 1));
  }
}
