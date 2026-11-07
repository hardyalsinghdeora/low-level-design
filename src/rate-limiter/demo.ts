import { FakeClock } from '../shared/clock';
import {
  FixedWindowLimiter,
  RateLimitExceededError,
  type RateLimiter,
  SlidingWindowCounterLimiter,
  SlidingWindowLogLimiter,
  StaticTierResolver,
  Tier,
  TieredRateLimiter,
  TokenBucketLimiter,
  withRateLimit,
} from './index';

interface ApiRequest {
  apiKey: string;
  path: string;
}
interface ApiResponse {
  status: number;
  body: string;
  retryAfterMs?: number;
}

const clock = new FakeClock('2026-03-01T09:00:00Z');
const limiter = new TieredRateLimiter(new StaticTierResolver({ 'key-acme': Tier.PRO }), {
  [Tier.FREE]: new TokenBucketLimiter({ capacity: 3, refillTokens: 1, refillEveryMs: 1_000 }, { clock }),
  [Tier.PRO]: new SlidingWindowCounterLimiter({ limit: 100, windowMs: 60_000 }, { clock }),
});

const getOrders = withRateLimit<ApiRequest, ApiResponse>((req) => ({ status: 200, body: `orders for ${req.apiKey}` }), {
  limiter,
  keyOf: (req) => req.apiKey,
  onLimited: (_req, decision) => ({ status: 429, body: 'Too Many Requests', retryAfterMs: decision.retryAfterMs ?? 0 }),
});

console.log('\n--- A free key bursts 5 requests; the bucket holds 3 ---');
for (let i = 1; i <= 5; i += 1) {
  const res = getOrders({ apiKey: 'key-free', path: '/orders' });
  console.log(`  request ${i}: ${res.status}${res.retryAfterMs !== undefined ? ` (Retry-After ${res.retryAfterMs} ms)` : ''}`);
}
console.log('  ...the pro key is unaffected:', getOrders({ apiKey: 'key-acme', path: '/orders' }).status);

console.log('\n--- 1.5 s later one token has refilled ---');
clock.advanceSeconds(1.5);
console.log(`  request 6: ${getOrders({ apiKey: 'key-free', path: '/orders' }).status}`);
console.log(`  request 7: ${getOrders({ apiKey: 'key-free', path: '/orders' }).status}`);

console.log('\n--- The boundary burst: 10 requests/min, 10 at :59 and 10 at :00 ---');
const burst = (name: string, l: RateLimiter): void => {
  clock.set('2026-03-01T09:00:59.000Z');
  let ok = 0;
  for (let i = 0; i < 10; i += 1) if (l.allow('k').allowed) ok += 1;
  clock.set('2026-03-01T09:01:00.000Z');
  for (let i = 0; i < 10; i += 1) if (l.allow('k').allowed) ok += 1;
  console.log(`  ${name.padEnd(22)} accepted ${ok} of 20 in one second`);
};
burst('fixed window', new FixedWindowLimiter({ limit: 10, windowMs: 60_000 }, { clock }));
burst('sliding window log', new SlidingWindowLogLimiter({ limit: 10, windowMs: 60_000 }, { clock }));
burst('sliding window counter', new SlidingWindowCounterLimiter({ limit: 10, windowMs: 60_000 }, { clock }));

console.log('\n--- An internal job uses the throwing variant and backs off ---');
const exportJob = withRateLimit((batch: number) => `exported batch ${batch}`, {
  limiter: new FixedWindowLimiter({ limit: 1, windowMs: 10_000 }, { clock }),
  keyOf: () => 'nightly-export',
});
console.log(`  ${exportJob(1)}`);
try {
  exportJob(2);
} catch (error) {
  if (!(error instanceof RateLimitExceededError)) throw error;
  console.log(`  ${error.name}: ${error.message}; scheduling batch 2 in ${error.retryAfterMs} ms`);
}
