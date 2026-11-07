import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AppenderClosedError,
  type Appender,
  AsyncAppender,
  ConsoleAppender,
  FileAppender,
  JsonFormatter,
  LoggerRegistry,
  LogLevel,
  parseLogLevel,
  StringSink,
} from './index';

const clock = new FakeClock('2026-03-01T09:00:00Z');
const registry = new LoggerRegistry({ rootLevel: LogLevel.INFO, clock, ids: new SequentialIdGenerator() });
registry.root.addAppender(new ConsoleAppender((line) => console.log(`  console | ${line}`)));

const file = new StringSink();
const jsonFile = new AsyncAppender(new FileAppender('payments.jsonl', file, { formatter: new JsonFormatter() }), { capacity: 100 });
registry.configure('app.payments', { level: parseLogLevel('debug'), appenders: [jsonFile] });

console.log('\n--- Root is INFO, so a DEBUG line from app.inventory is filtered ---');
const inventory = registry.getLogger('app.inventory');
inventory.debug('Cache warm-up details', { items: 1200 });
inventory.info('Stock synced', { warehouse: 'BLR-1' });

console.log('\n--- app.payments.gateway inherits DEBUG and the JSON file from app.payments ---');
const gateway = registry.getLogger('app.payments.gateway');
gateway.debug('Calling acquirer', { orderId: 'ord-42' });
clock.advanceSeconds(2);
gateway.warn('Acquirer slow, retrying', { orderId: 'ord-42', attempt: 2 });
console.log(`  loggers: ${registry.loggerNames().join(', ')}`);
console.log(`  buffered in the async appender: ${jsonFile.pending}, written to file so far: ${file.chunks.length}`);

console.log('\n--- flush() writes the batch to the file in arrival order ---');
registry.flushAll();
for (const line of file.contents.trim().split('\n')) console.log(`  file    | ${line}`);

console.log('\n--- A broken appender cannot take the request down ---');
const flaky: Appender = {
  name: 'metrics-forwarder',
  append: () => {
    throw new Error('socket closed');
  },
  flush: () => {},
};
registry.getLogger('app').addAppender(flaky);
gateway.error('Payment declined', { orderId: 'ord-42' }, new Error('Card expired'));
for (const failure of registry.failures) console.log(`  appender ${failure.appender} failed on ${failure.recordId}`);

console.log('\n--- Shutdown: close() drains, later writes are refused ---');
jsonFile.close();
console.log(`  file now holds ${file.chunks.length} lines, appender state ${jsonFile.state}`);
try {
  jsonFile.append({ id: 'late', timestamp: clock.now(), level: LogLevel.INFO, logger: 'app', message: 'late', context: {} });
} catch (error) {
  if (!(error instanceof AppenderClosedError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
}
