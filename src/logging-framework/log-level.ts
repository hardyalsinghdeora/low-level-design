import { UnknownLogLevelError } from './errors';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL',
}

/** String enums read well in output; the ordering lives in one table instead of in enum numbers. */
const SEVERITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.FATAL]: 50,
};

export function severity(level: LogLevel): number {
  return SEVERITY[level];
}

/** True when a record at `level` passes a `threshold` (DEBUG < INFO < WARN < ERROR < FATAL). */
export function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[threshold];
}

/** Parses configuration text such as "warn" or " ERROR ". */
export function parseLogLevel(text: string): LogLevel {
  const upper = text.trim().toUpperCase();
  const level = Object.values(LogLevel).find((candidate) => candidate === upper);
  if (!level) throw new UnknownLogLevelError(text);
  return level;
}
