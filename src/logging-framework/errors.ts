import { DomainError } from '../shared/errors';

export class LoggingError extends DomainError {}

export class InvalidLoggerNameError extends LoggingError {
  constructor(name: string) {
    super(`Invalid logger name "${name}": use dot-separated segments of letters, digits, "_" or "-"`);
  }
}

export class UnknownLogLevelError extends LoggingError {
  constructor(text: string) {
    super(`Unknown log level "${text}"`);
  }
}

export class DuplicateAppenderError extends LoggingError {
  constructor(loggerName: string, appenderName: string) {
    super(`Logger "${loggerName}" already has an appender named "${appenderName}"`);
  }
}

export class RootLevelRequiredError extends LoggingError {
  constructor() {
    super('The root logger must always have a level: every other logger falls back to it');
  }
}

export class AppenderClosedError extends LoggingError {
  constructor(appenderName: string) {
    super(`Appender "${appenderName}" is closed`);
  }
}

export class InvalidBufferCapacityError extends LoggingError {
  constructor(capacity: number) {
    super(`Buffer capacity must be a positive integer, got ${capacity}`);
  }
}
