import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  type Appender,
  AppenderClosedError,
  AppenderState,
  AsyncAppender,
  ConsoleAppender,
  DuplicateAppenderError,
  FileAppender,
  InMemoryAppender,
  InvalidBufferCapacityError,
  InvalidLoggerNameError,
  isLevelEnabled,
  JsonFormatter,
  LoggerRegistry,
  LogLevel,
  parseLogLevel,
  RootLevelRequiredError,
  StringSink,
  UnknownLogLevelError,
} from './index';

function setup(rootLevel = LogLevel.INFO) {
  const clock = new FakeClock('2026-01-01T09:00:00Z');
  const registry = new LoggerRegistry({ rootLevel, clock, ids: new SequentialIdGenerator() });
  const memory = new InMemoryAppender('memory');
  registry.root.addAppender(memory);
  return { clock, registry, memory };
}

describe('LogLevel', () => {
  it('orders DEBUG < INFO < WARN < ERROR < FATAL and parses config text', () => {
    expect(isLevelEnabled(LogLevel.WARN, LogLevel.INFO)).toBe(true);
    expect(isLevelEnabled(LogLevel.DEBUG, LogLevel.INFO)).toBe(false);
    expect(isLevelEnabled(LogLevel.FATAL, LogLevel.ERROR)).toBe(true);
    expect(parseLogLevel(' warn ')).toBe(LogLevel.WARN);
    expect(() => parseLogLevel('verbose')).toThrow(UnknownLogLevelError);
  });
});

describe('Logger filtering and hierarchy', () => {
  it('drops records below the effective level and stamps the ones it keeps', () => {
    const { registry, memory } = setup(LogLevel.INFO);
    const app = registry.getLogger('app');
    app.debug('noise');
    app.info('started', { port: 8080 });
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0]).toMatchObject({ id: 'log-1', level: LogLevel.INFO, logger: 'app', message: 'started' });
    expect(memory.records[0]?.timestamp.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });

  it('lets app.payments inherit level and appenders from app unless overridden', () => {
    const { registry, memory } = setup(LogLevel.DEBUG);
    const appOnly = new InMemoryAppender('app-only');
    registry.configure('app', { level: LogLevel.WARN, appenders: [appOnly] });
    const payments = registry.getLogger('app.payments');

    expect(payments.level).toBeUndefined();
    expect(payments.effectiveLevel()).toBe(LogLevel.WARN);
    payments.info('dropped');
    payments.warn('kept');
    expect(appOnly.messages()).toEqual(['kept']);
    expect(memory.messages()).toEqual(['kept']); // additive: root's appender too

    payments.setLevel(LogLevel.DEBUG);
    payments.debug('override');
    expect(appOnly.messages()).toEqual(['kept', 'override']);
  });

  it('applies a later level change on an ancestor to existing descendants', () => {
    const { registry, memory } = setup(LogLevel.INFO);
    const gateway = registry.getLogger('app.payments.gateway');
    expect(registry.loggerNames()).toEqual(['app', 'app.payments', 'app.payments.gateway', 'root']);
    expect(gateway.parent?.parent?.name).toBe('app');
    registry.getLogger('app').setLevel(LogLevel.ERROR);
    gateway.warn('suppressed');
    gateway.error('visible');
    expect(memory.messages()).toEqual(['visible']);
  });

  it('stops at a non-additive logger', () => {
    const { registry, memory } = setup();
    const audit = new InMemoryAppender('audit');
    registry.configure('audit', { additive: false, appenders: [audit] });
    registry.getLogger('audit.login').info('user signed in');
    expect(audit.messages()).toEqual(['user signed in']);
    expect(memory.records).toHaveLength(0);
  });

  it('validates names, keeps the root level and rejects duplicate appender names', () => {
    const { registry } = setup();
    for (const bad of ['', '.app', 'app.', 'app..x', 'app payments']) {
      expect(() => registry.getLogger(bad)).toThrow(InvalidLoggerNameError);
    }
    expect(registry.getLogger('app')).toBe(registry.getLogger('app'));
    expect(() => registry.root.setLevel(undefined)).toThrow(RootLevelRequiredError);
    expect(() => registry.root.addAppender(new InMemoryAppender('memory'))).toThrow(DuplicateAppenderError);
  });

  it('isolates a failing appender and reports the failure', () => {
    const { registry, memory } = setup();
    const broken: Appender = {
      name: 'broken',
      append: () => {
        throw new Error('disk full');
      },
      flush: () => {},
    };
    registry.getLogger('app').addAppender(broken);
    registry.getLogger('app').error('still delivered');
    expect(memory.messages()).toEqual(['still delivered']);
    expect(registry.failures).toEqual([{ appender: 'broken', recordId: 'log-1', error: new Error('disk full') }]);
  });
});

describe('Formatters and appenders', () => {
  it('formats plain text lines through the console appender', () => {
    const { registry } = setup();
    const lines: string[] = [];
    registry.getLogger('app').addAppender(new ConsoleAppender((line) => lines.push(line)));
    registry.getLogger('app.payments').warn('Retrying', { orderId: 42, gateway: 'acme' }, new Error('timeout'));
    expect(lines).toEqual([
      '2026-01-01T09:00:00.000Z WARN  [app.payments] Retrying orderId=42 gateway=acme error="Error: timeout"',
    ]);
  });

  it('formats JSON with context nested so it cannot clobber reserved fields', () => {
    const { registry, memory } = setup();
    registry.getLogger('app').info('Charged', { level: 'fake', amountMinor: 49_900 });
    const parsed: unknown = JSON.parse(new JsonFormatter().format(memory.records[0]!));
    expect(parsed).toEqual({
      id: 'log-1',
      timestamp: '2026-01-01T09:00:00.000Z',
      level: 'INFO',
      logger: 'app',
      message: 'Charged',
      context: { level: 'fake', amountMinor: 49_900 },
    });
  });

  it('writes newline-terminated lines to the file sink, honouring the appender threshold', () => {
    const { registry } = setup(LogLevel.DEBUG);
    const sink = new StringSink();
    registry.root.addAppender(new FileAppender('errors.log', sink, { minLevel: LogLevel.ERROR }));
    const app = registry.getLogger('app');
    app.info('fine');
    app.error('boom');
    registry.flushAll();
    expect(sink.contents).toBe('2026-01-01T09:00:00.000Z ERROR [app] boom\n');
    expect(sink.flushes).toBe(1);
  });
});

describe('AsyncAppender', () => {
  it('buffers until flush and then delivers in arrival order across loggers', () => {
    const { registry, clock } = setup();
    const target = new InMemoryAppender('target');
    const async = new AsyncAppender(target);
    registry.root.addAppender(async);
    registry.getLogger('a').info('one');
    clock.advanceSeconds(1);
    registry.getLogger('b').info('two');
    registry.getLogger('a').warn('three');
    expect(target.records).toHaveLength(0);
    expect(async.pending).toBe(3);

    async.flush();
    expect(target.messages()).toEqual(['one', 'two', 'three']);
    expect(target.records.map((r) => r.id)).toEqual(['log-1', 'log-2', 'log-3']);
    expect(async.pending).toBe(0);
  });

  it('drops the oldest record on overflow and counts it', () => {
    const { registry } = setup();
    const target = new InMemoryAppender('target');
    const async = new AsyncAppender(target, { capacity: 2 });
    registry.root.addAppender(async);
    for (const message of ['m1', 'm2', 'm3']) registry.getLogger('app').info(message);
    async.flush();
    expect(target.messages()).toEqual(['m2', 'm3']);
    expect(async.dropped).toBe(1);
    expect(() => new AsyncAppender(target, { capacity: 0 })).toThrow(InvalidBufferCapacityError);
  });

  it('drains on close and refuses every call afterwards', () => {
    const { registry, memory } = setup();
    const target = new InMemoryAppender('target');
    const async = new AsyncAppender(target);
    registry.getLogger('app').addAppender(async);
    registry.getLogger('app').info('last words');
    async.close();
    expect(target.messages()).toEqual(['last words']);
    expect(async.state).toBe(AppenderState.CLOSED);
    expect(() => async.flush()).toThrow(AppenderClosedError);
    expect(() => async.close()).toThrow(AppenderClosedError);

    registry.getLogger('app').info('after close'); // the logger survives; the failure is recorded
    expect(memory.messages()).toEqual(['last words', 'after close']);
    expect(registry.failures[0]?.error).toBeInstanceOf(AppenderClosedError);
  });
});
