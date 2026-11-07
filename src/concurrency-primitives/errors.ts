import { DomainError } from '../shared/errors';

export class ConcurrencyError extends DomainError {}

/** Releasing a lock nobody holds is always a bug in the caller; fail loudly instead of corrupting the count. */
export class NotLockedError extends ConcurrencyError {
  constructor(primitive: string) {
    super(`${primitive} released while not held`);
  }
}

export class PermitOverflowError extends ConcurrencyError {
  constructor(maxPermits: number) {
    super(`Semaphore released beyond its ${maxPermits} permit(s)`);
  }
}
