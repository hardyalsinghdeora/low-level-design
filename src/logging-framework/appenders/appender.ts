import { isLevelEnabled, LogLevel } from '../log-level';
import type { LogRecord } from '../log-record';
import { type Formatter, PlainTextFormatter } from '../strategies/formatter';

/** Where records go. Loggers decide *whether* to log; appenders decide *where* and *how*. */
export interface Appender {
  readonly name: string;
  append(record: LogRecord): void;
  flush(): void;
}

export interface FormattingAppenderOptions {
  formatter?: Formatter;
  /** A per-destination threshold, e.g. only ERROR and above to the pager file. */
  minLevel?: LogLevel;
}

/** Shared plumbing for appenders that format a record into one line and write it somewhere. */
export abstract class FormattingAppender implements Appender {
  protected readonly formatter: Formatter;
  private readonly minLevel: LogLevel;

  constructor(
    readonly name: string,
    options: FormattingAppenderOptions = {},
  ) {
    this.formatter = options.formatter ?? new PlainTextFormatter();
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
  }

  append(record: LogRecord): void {
    if (!isLevelEnabled(record.level, this.minLevel)) return;
    this.write(this.formatter.format(record), record);
  }

  flush(): void {}

  protected abstract write(line: string, record: LogRecord): void;
}

/** Writes to a terminal through an injected function, so neither tests nor the core touch the real stdout. */
export class ConsoleAppender extends FormattingAppender {
  constructor(
    private readonly writeLine: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    options: FormattingAppenderOptions & { name?: string } = {},
  ) {
    super(options.name ?? 'console', options);
  }

  protected write(line: string): void {
    this.writeLine(line);
  }
}

/** Keeps every record and line in memory: the appender tests and demos assert against. */
export class InMemoryAppender extends FormattingAppender {
  readonly records: LogRecord[] = [];
  readonly lines: string[] = [];

  protected write(line: string, record: LogRecord): void {
    this.records.push(record);
    this.lines.push(line);
  }

  messages(): string[] {
    return this.records.map((record) => record.message);
  }
}
