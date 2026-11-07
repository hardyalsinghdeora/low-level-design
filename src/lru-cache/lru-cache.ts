import { SystemClock } from '../shared/clock';
import {
  assertCapacity,
  type Cache,
  type CacheOptions,
  type EvictionListener,
  EvictionReason,
  type PutOptions,
} from './cache';
import { DoublyLinkedList, ListNode } from './doubly-linked-list';
import { ExpiryPolicy } from './expiry';

interface LruEntry<K, V> {
  readonly key: K;
  value: V;
  expiresAt: number | undefined;
}

type LruNode<K, V> = ListNode<LruEntry<K, V>>;

/**
 * Least-recently-used cache. The Map answers "where is this key" in O(1); the
 * linked list keeps recency order (head = most recent), so promoting an entry
 * and finding the victim (the tail) are O(1) as well. Neither structure can do
 * both on its own, which is the whole point of the design.
 */
export class LRUCache<K, V> implements Cache<K, V> {
  readonly capacity: number;
  private readonly index = new Map<K, LruNode<K, V>>();
  private readonly recency = new DoublyLinkedList<LruEntry<K, V>>();
  private readonly expiry: ExpiryPolicy;
  private readonly onEvict: EvictionListener<K, V> | undefined;

  constructor(options: CacheOptions<K, V>) {
    assertCapacity(options.capacity);
    this.capacity = options.capacity;
    this.expiry = new ExpiryPolicy(options.clock ?? new SystemClock(), options.defaultTtlMs);
    this.onEvict = options.onEvict;
  }

  get size(): number {
    return this.index.size;
  }

  get(key: K): V | undefined {
    const node = this.liveNode(key);
    if (!node) return undefined;
    this.recency.moveToFront(node);
    return node.value.value;
  }

  peek(key: K): V | undefined {
    return this.liveNode(key)?.value.value;
  }

  has(key: K): boolean {
    return this.liveNode(key) !== undefined;
  }

  put(key: K, value: V, options: PutOptions = {}): void {
    const expiresAt = this.expiry.expiresAt(options.ttlMs);
    const existing = this.liveNode(key);
    if (existing) {
      existing.value.value = value;
      existing.value.expiresAt = expiresAt;
      this.recency.moveToFront(existing);
      return;
    }
    if (this.capacity === 0) {
      // Nothing can be stored; report it the same way a full cache would.
      this.onEvict?.(key, value, EvictionReason.CAPACITY);
      return;
    }
    if (this.index.size >= this.capacity) this.evictLeastRecent();
    const node = new ListNode<LruEntry<K, V>>({ key, value, expiresAt });
    this.recency.pushFront(node);
    this.index.set(key, node);
  }

  delete(key: K): boolean {
    const node = this.liveNode(key);
    if (!node) return false;
    this.unlink(node);
    return true;
  }

  /** Most recently used first; expired entries met on the way are collected. */
  keys(): K[] {
    const live: K[] = [];
    for (const node of this.recency.nodes()) {
      if (this.expiry.isExpired(node.value.expiresAt)) this.evict(node, EvictionReason.EXPIRED);
      else live.push(node.value.key);
    }
    return live;
  }

  clear(): void {
    this.index.clear();
    this.recency.clear();
  }

  /** The node for `key` if present and not expired. An expired node is collected on the spot (lazy expiry). */
  private liveNode(key: K): LruNode<K, V> | undefined {
    const node = this.index.get(key);
    if (!node) return undefined;
    if (this.expiry.isExpired(node.value.expiresAt)) {
      this.evict(node, EvictionReason.EXPIRED);
      return undefined;
    }
    return node;
  }

  private evictLeastRecent(): void {
    const victim = this.recency.last;
    if (!victim) return;
    const expired = this.expiry.isExpired(victim.value.expiresAt);
    this.evict(victim, expired ? EvictionReason.EXPIRED : EvictionReason.CAPACITY);
  }

  /** Unlinks first, then notifies, so the listener always sees a consistent cache. */
  private evict(node: LruNode<K, V>, reason: EvictionReason): void {
    this.unlink(node);
    this.onEvict?.(node.value.key, node.value.value, reason);
  }

  private unlink(node: LruNode<K, V>): void {
    this.recency.remove(node);
    this.index.delete(node.value.key);
  }
}
