import { randomUUID } from 'node:crypto';

/** Identifier generation is injected so tests get predictable ids. */
export interface IdGenerator {
  next(prefix?: string): string;
}

export class UuidGenerator implements IdGenerator {
  next(prefix = ''): string {
    const id = randomUUID();
    return prefix ? `${prefix}-${id}` : id;
  }
}

/** Produces `prefix-1`, `prefix-2`, ... Deterministic, for tests and demos. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next(prefix = 'id'): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }
}
