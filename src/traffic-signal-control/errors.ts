import { DomainError } from '../shared/errors';

export class InvalidSignalTransitionError extends DomainError {
  constructor(direction: string, from: string, to: string) {
    super(`Light ${direction} cannot go ${from} -> ${to}`);
  }
}

/** The safety invariant. Should be unreachable; it exists so a bug fails loudly instead of crashing cars. */
export class ConflictingGreenError extends DomainError {
  constructor(a: string, b: string) {
    super(`Conflicting directions ${a} and ${b} would both be moving`);
  }
}

export class InvalidTimingError extends DomainError {
  constructor(detail: string) {
    super(`Invalid timing: ${detail}`);
  }
}

export class PreemptionActiveError extends DomainError {
  constructor(active: string, requested: string) {
    super(`Preemption for ${active} is active; cannot preempt for ${requested}`);
  }
}

export class NoPreemptionActiveError extends DomainError {
  constructor() {
    super('No emergency preemption is active');
  }
}
