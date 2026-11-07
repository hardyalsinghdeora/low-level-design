import type { Clock } from '../shared/clock';
import type { IdGenerator } from '../shared/id-generator';
import type { Appender } from './appenders/appender';
import { DuplicateAppenderError, RootLevelRequiredError } from './errors';
import { isLevelEnabled, LogLevel } from './log-level';
import type { LogContext, LogRecord } from './log-record';

export type AppenderErrorHandler = (appender: Appender, record: LogRecord, error: unknown) => void;

/** What a registry shares with all of its loggers. */
export interface LoggerContext {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly onAppenderError: AppenderErrorHandler;
}

/**
 * A named node in the logger hierarchy. Its level and appenders are optional:
 * unset values are inherited from the nearest ancestor at call time, so a
 * change on "app" is seen at once by "app.payments" and every logger below it.
 */
export class Logger {
  private ownLevel: LogLevel | undefined;
  private readonly ownAppenders: Appender[] = [];
  /** When false, records stop here instead of also reaching the ancestors' appenders. */
  additive = true;

  constructor(
    readonly name: string,
    readonly parent: Logger | undefined,
    private readonly context: LoggerContext,
    level?: LogLevel,
  ) {
    this.ownLevel = level;
    if (!parent && level === undefined) throw new RootLevelRequiredError();
  }

  /** The level set on this logger itself; undefined means "inherit". */
  get level(): LogLevel | undefined {
    return this.ownLevel;
  }

  setLevel(level: LogLevel | undefined): this {
    if (!this.parent && level === undefined) throw new RootLevelRequiredError();
    this.ownLevel = level;
    return this;
  }

  effectiveLevel(): LogLevel {
    for (let logger: Logger | undefined = this; logger; logger = logger.parent) {
      if (logger.ownLevel !== undefined) return logger.ownLevel;
    }
    throw new RootLevelRequiredError(); // unreachable: the root always has a level
  }

  addAppender(appender: Appender): this {
    if (this.ownAppenders.some((existing) => existing.name === appender.name)) {
      throw new DuplicateAppenderError(this.name, appender.name);
    }
    this.ownAppenders.push(appender);
    return this;
  }

  removeAppender(name: string): boolean {
    const index = this.ownAppenders.findIndex((appender) => appender.name === name);
    if (index < 0) return false;
    this.ownAppenders.splice(index, 1);
    return true;
  }

  get appenders(): readonly Appender[] {
    return this.ownAppenders;
  }

  /** Own appenders first, then the ancestors' while the chain stays additive. */
  effectiveAppenders(): Appender[] {
    const out: Appender[] = [];
    for (let logger: Logger | undefined = this; logger; logger = logger.parent) {
      out.push(...logger.ownAppenders);
      if (!logger.additive) break;
    }
    return out;
  }

  isEnabled(level: LogLevel): boolean {
    return isLevelEnabled(level, this.effectiveLevel());
  }

  log(level: LogLevel, message: string, context: LogContext = {}, error?: Error): void {
    // Cheap check first: a filtered DEBUG call must not pay for ids, clock reads or formatting.
    if (!this.isEnabled(level)) return;
    const record: LogRecord = {
      id: this.context.ids.next('log'),
      timestamp: this.context.clock.now(),
      level,
      logger: this.name,
      message,
      context: { ...context },
      ...(error ? { error } : {}),
    };
    for (const appender of this.effectiveAppenders()) {
      // Logging must never take the application down, and one broken appender must not starve the others.
      try {
        appender.append(record);
      } catch (failure) {
        this.context.onAppenderError(appender, record, failure);
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.WARN, message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  fatal(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.FATAL, message, context, error);
  }
}
