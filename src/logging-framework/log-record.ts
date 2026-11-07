import type { LogLevel } from './log-level';

export type LogContext = Readonly<Record<string, unknown>>;

/**
 * One immutable event. Loggers build it once and every appender receives the
 * same object, so formatting differences never change what was logged.
 */
export interface LogRecord {
  readonly id: string;
  readonly timestamp: Date;
  readonly level: LogLevel;
  readonly logger: string;
  readonly message: string;
  readonly context: LogContext;
  readonly error?: Error;
}
