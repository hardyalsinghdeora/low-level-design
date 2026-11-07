import { InvalidConfigurationError } from '../errors';

/** Strategy: how many sends to try and how long to wait after a failure. */
export interface RetryPolicy {
  /** Total sends allowed, the first included. */
  readonly maxAttempts: number;
  delayMs(failedAttempt: number): number;
}

export interface ExponentialBackoffOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Adds up to this fraction of the delay at random so retries from an outage do not arrive together. */
  jitterRatio?: number;
  rng?: () => number;
}

export class ExponentialBackoffPolicy implements RetryPolicy {
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;
  private readonly rng: () => number;

  constructor(options: ExponentialBackoffOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.jitterRatio = options.jitterRatio ?? 0;
    this.rng = options.rng ?? Math.random;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new InvalidConfigurationError(`maxAttempts must be a positive integer, got ${this.maxAttempts}`);
    }
  }

  delayMs(failedAttempt: number): number {
    const raw = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (failedAttempt - 1));
    return raw + Math.floor(raw * this.jitterRatio * this.rng());
  }
}
