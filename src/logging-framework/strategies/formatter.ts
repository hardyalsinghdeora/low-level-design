import type { LogRecord } from '../log-record';

/** Strategy pattern: how a record becomes text is independent of where it is written. */
export interface Formatter {
  format(record: LogRecord): string;
}

/** Human-readable single line: `2026-01-01T09:00:00.000Z WARN  [app.payments] Retrying orderId=42`. */
export class PlainTextFormatter implements Formatter {
  format(record: LogRecord): string {
    const parts = [record.timestamp.toISOString(), record.level.padEnd(5), `[${record.logger}]`, record.message];
    const context = Object.entries(record.context)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    if (context) parts.push(context);
    if (record.error) parts.push(`error="${record.error.name}: ${record.error.message}"`);
    return parts.join(' ');
  }
}

/**
 * One JSON object per line for log shippers. Context sits under its own key so
 * a caller's `level` or `message` field can never overwrite the real ones.
 */
export class JsonFormatter implements Formatter {
  format(record: LogRecord): string {
    return JSON.stringify({
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      level: record.level,
      logger: record.logger,
      message: record.message,
      ...(Object.keys(record.context).length > 0 ? { context: record.context } : {}),
      ...(record.error ? { error: { name: record.error.name, message: record.error.message } } : {}),
    });
  }
}
