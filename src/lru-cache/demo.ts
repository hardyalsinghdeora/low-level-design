import { FakeClock } from '../shared/clock';
import { formatMoney } from '../shared/money';
import { type EvictionReason, InvalidTtlError, LFUCache, LRUCache } from './index';

const clock = new FakeClock('2026-03-01T10:00:00Z');
const report = (key: string, _value: unknown, reason: EvictionReason): void => {
  console.log(`    evicted ${key} (${reason})`);
};

console.log('\n--- Product cache in front of a slow catalogue DB (LRU, capacity 3) ---');
const products = new LRUCache<string, string>({ capacity: 3, clock, onEvict: report });
products.put('sku-1', 'Kettle');
products.put('sku-2', 'Toaster');
products.put('sku-3', 'Blender');
products.get('sku-1'); // a shopper opens the kettle again
console.log(`  recency order: ${products.keys().join(' > ')}`);
console.log('  sku-4 is requested; the least recently used product leaves:');
products.put('sku-4', 'Mixer');
console.log(`  recency order: ${products.keys().join(' > ')}`);

console.log('\n--- Prices expire after 5 minutes, checked lazily on read ---');
const prices = new LRUCache<string, number>({ capacity: 10, defaultTtlMs: 5 * 60_000, clock, onEvict: report });
prices.put('sku-1', 249_900); // paise
prices.put('sku-2', 189_900, { ttlMs: 60 * 60_000 }); // a contract price, valid for an hour
clock.advanceMinutes(5);
console.log(`  size before anyone reads: ${prices.size}`);
const kettle = prices.get('sku-1');
console.log(`  sku-1 price: ${kettle === undefined ? 'miss, reload from the DB' : formatMoney(kettle)}`);
console.log(`  sku-2 price: ${formatMoney(prices.get('sku-2') ?? 0)}`);
console.log(`  size after the reads: ${prices.size}`);

console.log('\n--- A one-off report scan: LRU drops the hot page, LFU keeps it ---');
const lru = new LRUCache<string, string>({ capacity: 2 });
const lfu = new LFUCache<string, string>({ capacity: 2 });
for (const cache of [lru, lfu]) {
  cache.put('home', '<html>home</html>');
  for (let i = 0; i < 5; i += 1) cache.get('home');
  cache.put('report-1', 'scan');
  cache.put('report-2', 'scan');
}
console.log(`  LRU keeps: ${lru.keys().join(', ')}`);
console.log(`  LFU keeps: ${lfu.keys().join(', ')} (home used ${lfu.frequency('home')} times)`);

console.log('\n--- A bad TTL is rejected before anything is evicted ---');
try {
  products.put('sku-5', 'Grill', { ttlMs: 0 });
} catch (error) {
  if (!(error instanceof InvalidTtlError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
}
console.log(`  still cached: ${products.keys().join(', ')}`);
