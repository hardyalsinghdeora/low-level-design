import { DomainError } from '../shared/errors';

export class CacheError extends DomainError {}

export class InvalidCapacityError extends CacheError {
  constructor(capacity: number) {
    super(`Capacity must be a non-negative integer, got ${capacity}`);
  }
}

export class InvalidTtlError extends CacheError {
  constructor(ttlMs: number) {
    super(`TTL must be a positive integer number of milliseconds, got ${ttlMs}`);
  }
}
