import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import {
  type Cache,
  type CacheOptions,
  EvictionReason,
  InvalidCapacityError,
  InvalidTtlError,
  LFUCache,
  LRUCache,
} from './index';

type Eviction = [key: string, value: number, reason: EvictionReason];

function recorder() {
  const evicted: Eviction[] = [];
  const onEvict = (key: string, value: number, reason: EvictionReason): void => {
    evicted.push([key, value, reason]);
  };
  return { evicted, onEvict };
}

function advanceMs(clock: FakeClock, ms: number): void {
  clock.set(new Date(clock.now().getTime() + ms));
}

const implementations: Array<[string, (options: CacheOptions<string, number>) => Cache<string, number>]> = [
  ['LRUCache', (options) => new LRUCache(options)],
  ['LFUCache', (options) => new LFUCache(options)],
];

describe.each(implementations)('%s (shared Cache contract)', (_name, create) => {
  it('expires entries lazily at exactly the TTL and reports them once', () => {
    const clock = new FakeClock('2026-01-01T09:00:00Z');
    const { evicted, onEvict } = recorder();
    const cache = create({ capacity: 3, defaultTtlMs: 1_000, clock, onEvict });
    cache.put('session', 1);
    cache.put('config', 2, { ttlMs: 60_000 });

    advanceMs(clock, 999);
    expect(cache.get('session')).toBe(1);

    advanceMs(clock, 1);
    expect(cache.size).toBe(2); // nothing is collected until the entry is touched
    expect(cache.get('session')).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.has('session')).toBe(false);
    expect(cache.get('config')).toBe(2);
    expect(evicted).toEqual([['session', 1, EvictionReason.EXPIRED]]);
  });

  it('stores nothing with capacity 0 and only the latest entry with capacity 1', () => {
    const { evicted, onEvict } = recorder();
    const none = create({ capacity: 0, onEvict });
    none.put('a', 1);
    expect(none.size).toBe(0);
    expect(none.get('a')).toBeUndefined();
    expect(evicted).toEqual([['a', 1, EvictionReason.CAPACITY]]);

    const one = create({ capacity: 1, onEvict });
    one.put('a', 1);
    one.get('a'); // even a frequently used entry must make room
    one.put('b', 2);
    expect(one.keys()).toEqual(['b']);
    expect(evicted[1]).toEqual(['a', 1, EvictionReason.CAPACITY]);
  });

  it('rejects an invalid capacity or TTL without touching existing entries', () => {
    expect(() => create({ capacity: -1 })).toThrow(InvalidCapacityError);
    expect(() => create({ capacity: 1.5 })).toThrow(InvalidCapacityError);
    expect(() => create({ capacity: 2, defaultTtlMs: 0 })).toThrow(InvalidTtlError);

    const { evicted, onEvict } = recorder();
    const cache = create({ capacity: 1, onEvict });
    cache.put('a', 1);
    expect(() => cache.put('b', 2, { ttlMs: -5 })).toThrow(InvalidTtlError);
    expect(cache.keys()).toEqual(['a']);
    expect(evicted).toEqual([]);
  });

  it('deletes explicitly without firing onEvict', () => {
    const { evicted, onEvict } = recorder();
    const cache = create({ capacity: 2, onEvict });
    cache.put('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.size).toBe(0);
    expect(evicted).toEqual([]);
  });
});

describe('LRUCache', () => {
  it('evicts the least recently used entry when full', () => {
    const { evicted, onEvict } = recorder();
    const cache = new LRUCache<string, number>({ capacity: 3, onEvict });
    cache.put('a', 1);
    cache.put('b', 2);
    cache.put('c', 3);
    expect(cache.keys()).toEqual(['c', 'b', 'a']);

    cache.put('d', 4);
    expect(evicted).toEqual([['a', 1, EvictionReason.CAPACITY]]);
    expect(cache.keys()).toEqual(['d', 'c', 'b']);
    expect(cache.size).toBe(3);
  });

  it('moves an entry to most recent on get and update, but not on peek or has', () => {
    const { evicted, onEvict } = recorder();
    const cache = new LRUCache<string, number>({ capacity: 3, onEvict });
    cache.put('a', 1);
    cache.put('b', 2);
    cache.put('c', 3);
    cache.get('a'); // a c b
    cache.put('b', 20); // b a c
    expect(cache.peek('c')).toBe(3);
    expect(cache.has('c')).toBe(true);
    expect(cache.keys()).toEqual(['b', 'a', 'c']);

    cache.put('d', 4);
    expect(evicted.map(([key]) => key)).toEqual(['c']);
    expect(cache.get('b')).toBe(20);
  });

  it('restarts the TTL on update and lets a per-entry TTL override the default', () => {
    const clock = new FakeClock();
    const cache = new LRUCache<string, number>({ capacity: 2, defaultTtlMs: 1_000, clock });
    cache.put('a', 1);
    cache.put('b', 2, { ttlMs: 5_000 });

    advanceMs(clock, 800);
    cache.put('a', 10); // expires 1 s from now, not from the first put
    advanceMs(clock, 800);
    expect(cache.get('a')).toBe(10);

    advanceMs(clock, 200);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });
});

describe('LFUCache', () => {
  it('evicts the least frequently used entry, the least recent one among ties', () => {
    const { evicted, onEvict } = recorder();
    const cache = new LFUCache<string, number>({ capacity: 3, onEvict });
    cache.put('a', 1);
    cache.put('b', 2);
    cache.put('c', 3);
    cache.get('c'); // c:2, then a and b at 1 with b more recent
    cache.put('d', 4); // victim: a
    cache.get('d');
    cache.get('d'); // d:3
    cache.put('e', 5); // victim: b, the only entry left at frequency 1

    expect(evicted.map(([key]) => key)).toEqual(['a', 'b']);
    expect(cache.keys()).toEqual(['d', 'c', 'e']);
    expect(['d', 'c', 'e'].map((key) => cache.frequency(key))).toEqual([3, 2, 1]);
  });

  it('counts updates as uses and stays consistent after a delete empties a bucket', () => {
    const cache = new LFUCache<string, number>({ capacity: 2 });
    cache.put('hot', 1);
    cache.put('hot', 2); // an update is a use: frequency 2
    cache.put('tmp', 1);
    expect(cache.frequency('hot')).toBe(2);

    cache.delete('tmp'); // the frequency-1 bucket disappears
    cache.put('x', 1);
    cache.put('y', 1); // the victim must be x, never hot
    expect(cache.keys()).toEqual(['hot', 'y']);
    expect(cache.get('hot')).toBe(2);
    expect(cache.frequency('hot')).toBe(3);
  });
});
