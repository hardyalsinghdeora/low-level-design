import { DomainError } from '../shared/errors';

export class RateLimitError extends DomainError {}

export class InvalidRateLimitConfigError extends RateLimitError {
  constructor(field: string, value: number) {
    super(`${field} must be a positive integer, got ${value}`);
  }
}

export class InvalidKeyError extends RateLimitError {
  constructor() {
    super('Rate limit key must be a non-empty string');
  }
}

/** The store kept rejecting our compare-and-set: too many concurrent writers on one key. */
export class StoreContentionError extends RateLimitError {
  constructor(key: string, attempts: number) {
    super(`Could not update rate limit state for "${key}" after ${attempts} attempts`);
  }
}

/** Thrown by withRateLimit when no onLimited handler is given; carries what an HTTP 429 needs. */
export class RateLimitExceededError extends RateLimitError {
  constructor(
    readonly key: string,
    readonly retryAfterMs: number,
  ) {
    super(`Rate limit exceeded for "${key}", retry after ${retryAfterMs} ms`);
  }
}

export function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new InvalidRateLimitConfigError(field, value);
}
