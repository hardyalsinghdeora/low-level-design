import { appendFileSync } from 'node:fs';
import { type FormattingAppenderOptions, FormattingAppender } from './appender';

/** The byte destination behind a FileAppender. Injected so tests never touch the disk. */
export interface FileSink {
  write(chunk: string): void;
  flush?(): void;
}

/** Appends to a real file. Synchronous on purpose: wrap the appender in AsyncAppender to batch. */
export class AppendFileSink implements FileSink {
  constructor(private readonly path: string) {}

  write(chunk: string): void {
    appendFileSync(this.path, chunk, 'utf8');
  }
}

/** Collects chunks in memory, standing in for a file in tests and the demo. */
export class StringSink implements FileSink {
  readonly chunks: string[] = [];
  flushes = 0;

  write(chunk: string): void {
    this.chunks.push(chunk);
  }

  flush(): void {
    this.flushes += 1;
  }

  get contents(): string {
    return this.chunks.join('');
  }
}

/** One formatted line per record, newline-terminated, written to a FileSink. */
export class FileAppender extends FormattingAppender {
  constructor(
    name: string,
    private readonly sink: FileSink,
    options: FormattingAppenderOptions = {},
  ) {
    super(name, options);
  }

  protected write(line: string): void {
    this.sink.write(`${line}\n`);
  }

  override flush(): void {
    this.sink.flush?.();
  }
}
