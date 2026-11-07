import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Appender } from './appenders/appender';
import { InvalidLoggerNameError } from './errors';
import { LogLevel } from './log-level';
import type { LogRecord } from './log-record';
import { type AppenderErrorHandler, Logger, type LoggerContext } from './logger';

export interface LoggerRegistryOptions {
  rootLevel?: LogLevel;
  clock?: Clock;
  ids?: IdGenerator;
  /** Called when an appender throws. Defaults to counting the failure. */
  onAppenderError?: AppenderErrorHandler;
}

export interface LoggerConfig {
  level?: LogLevel;
  additive?: boolean;
  appenders?: Appender[];
}

export interface AppenderFailure {
  appender: string;
  recordId: string;
  error: unknown;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/**
 * Owns the logger tree. getLogger("app.payments") creates "app" on the way,
 * so every logger has a parent and inheritance is a simple walk to the root.
 *
 * This is a plain instance, not a static LogManager Singleton: the composition
 * root creates one for the process, and tests create a fresh one each so
 * configuration never leaks between them.
 */
export class LoggerRegistry {
  readonly root: Logger;
  readonly failures: AppenderFailure[] = [];
  private readonly loggers = new Map<string, Logger>();
  private readonly context: LoggerContext;

  constructor(options: LoggerRegistryOptions = {}) {
    const context: LoggerContext = {
      clock: options.clock ?? new SystemClock(),
      ids: options.ids ?? new UuidGenerator(),
      onAppenderError:
        options.onAppenderError ??
        ((appender: Appender, record: LogRecord, error: unknown) => {
          this.failures.push({ appender: appender.name, recordId: record.id, error });
        }),
    };
    this.root = new Logger('root', undefined, context, options.rootLevel ?? LogLevel.INFO);
    this.loggers.set('root', this.root);
    this.context = context;
  }

  getLogger(name: string): Logger {
    if (!NAME_PATTERN.test(name)) throw new InvalidLoggerNameError(name);
    const existing = this.loggers.get(name);
    if (existing) return existing;
    const dot = name.lastIndexOf('.');
    const parent = dot < 0 ? this.root : this.getLogger(name.slice(0, dot));
    const logger = new Logger(name, parent, this.context);
    this.loggers.set(name, logger);
    return logger;
  }

  /** Applies a config block, as a hot-reloaded config file would. */
  configure(name: string, config: LoggerConfig): Logger {
    const logger = this.getLogger(name);
    if ('level' in config) logger.setLevel(config.level);
    if (config.additive !== undefined) logger.additive = config.additive;
    for (const appender of config.appenders ?? []) logger.addAppender(appender);
    return logger;
  }

  loggerNames(): string[] {
    return [...this.loggers.keys()].sort();
  }

  /** Flushes every distinct appender once, e.g. on shutdown. */
  flushAll(): void {
    const seen = new Set<Appender>();
    for (const logger of this.loggers.values()) {
      for (const appender of logger.appenders) {
        if (seen.has(appender)) continue;
        seen.add(appender);
        appender.flush();
      }
    }
  }
}
