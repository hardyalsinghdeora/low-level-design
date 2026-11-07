/**
 * Time is an input, not a global. Injecting a Clock makes fee calculation,
 * expiry and scheduling logic deterministic in tests.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A controllable clock for tests and demos. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-01-01T09:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(to: Date | string): void {
    this.current = new Date(to);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }

  advanceMinutes(minutes: number): void {
    this.advanceSeconds(minutes * 60);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }
}
