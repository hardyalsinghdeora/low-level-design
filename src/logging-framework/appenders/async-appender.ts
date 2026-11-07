import { AppenderClosedError, InvalidBufferCapacityError } from '../errors';
import type { LogRecord } from '../log-record';
import type { Appender } from './appender';

export enum AppenderState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export interface AsyncAppenderOptions {
  /** Records held before the oldest is dropped. Bounded so a slow sink cannot exhaust memory. */
  capacity?: number;
}

/**
 * Decorator that takes the slow write off the caller's path: append() only
 * buffers, and flush() hands the batch to the wrapped appender in arrival
 * order. Production code would flush from a background worker or on a timer;
 * here the caller drives it explicitly so tests stay deterministic.
 */
export class AsyncAppender implements Appender {
  private buffer: LogRecord[] = [];
  private currentState = AppenderState.OPEN;
  private droppedCount = 0;
  private readonly capacity: number;

  constructor(
    private readonly target: Appender,
    options: AsyncAppenderOptions = {},
  ) {
    const capacity = options.capacity ?? 1_000;
    if (!Number.isInteger(capacity) || capacity <= 0) throw new InvalidBufferCapacityError(capacity);
    this.capacity = capacity;
  }

  get name(): string {
    return `async(${this.target.name})`;
  }

  get state(): AppenderState {
    return this.currentState;
  }

  get pending(): number {
    return this.buffer.length;
  }

  /** Records lost to overflow. Exposed so it can become a metric instead of a silent loss. */
  get dropped(): number {
    return this.droppedCount;
  }

  append(record: LogRecord): void {
    this.assertOpen();
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
      this.droppedCount += 1;
    }
    this.buffer.push(record);
  }

  flush(): void {
    this.assertOpen();
    this.drain();
  }

  /** OPEN -> CLOSED, draining first so shutdown never loses buffered records. */
  close(): void {
    this.assertOpen();
    this.drain();
    this.currentState = AppenderState.CLOSED;
  }

  private drain(): void {
    // Swap before writing so a record appended by the target (or a listener) lands in the next batch.
    const batch = this.buffer;
    this.buffer = [];
    for (const record of batch) this.target.append(record);
    this.target.flush();
  }

  private assertOpen(): void {
    if (this.currentState !== AppenderState.OPEN) throw new AppenderClosedError(this.name);
  }
}
