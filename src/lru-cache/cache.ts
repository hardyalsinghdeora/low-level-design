import type { Clock } from '../shared/clock';
import { InvalidCapacityError } from './errors';

export enum EvictionReason {
  /** The cache was full and this entry was the policy's victim. */
  CAPACITY = 'CAPACITY',
  /** The entry's TTL had passed when the cache next touched it. */
  EXPIRED = 'EXPIRED',
}

export type EvictionListener<K, V> = (key: K, value: V, reason: EvictionReason) => void;

export interface PutOptions {
  /** Overrides the cache-wide default TTL for this entry. */
  ttlMs?: number;
}

export interface CacheOptions<K, V> {
  /** Maximum number of entries. 0 is allowed: the cache then stores nothing. */
  capacity: number;
  /** TTL for entries put without their own. Omit for entries that never expire. */
  defaultTtlMs?: number;
  clock?: Clock;
  /** Fired after an entry leaves because of capacity or expiry, never for an explicit delete or clear. */
  onEvict?: EvictionListener<K, V>;
}

/**
 * The contract LRU and LFU share. Callers depend on "a bounded cache", so the
 * eviction policy can change without touching them.
 */
export interface Cache<K, V> {
  readonly capacity: number;
  /** Stored entries, including expired ones not collected yet: expiry is lazy. */
  readonly size: number;
  /** Returns the value and records the access (recency or frequency). */
  get(key: K): V | undefined;
  /** Returns the value without recording an access. */
  peek(key: K): V | undefined;
  has(key: K): boolean;
  /** Inserts or replaces. Replacing counts as an access and resets the TTL. */
  put(key: K, value: V, options?: PutOptions): void;
  /** Removes a live entry. Returns false if it was absent or already expired. */
  delete(key: K): boolean;
  /** Live keys, safest first and the next eviction victim last. */
  keys(): K[];
  clear(): void;
}

export function assertCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity < 0) throw new InvalidCapacityError(capacity);
}
