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

interface FrequencyBucket<K, V> {
  readonly frequency: number;
  /** Entries used exactly `frequency` times, most recently used first. */
  readonly entries: DoublyLinkedList<LfuEntry<K, V>>;
}

interface LfuEntry<K, V> {
  readonly key: K;
  value: V;
  expiresAt: number | undefined;
  bucket: ListNode<FrequencyBucket<K, V>>;
}

type LfuNode<K, V> = ListNode<LfuEntry<K, V>>;
type BucketNode<K, V> = ListNode<FrequencyBucket<K, V>>;

/**
 * Least-frequently-used cache with O(1) get, put and delete. Entries sit in
 * frequency buckets kept in ascending order, and each bucket is a recency list,
 * so the victim is the tail of the first bucket: least frequent, and among
 * those the least recently used. Linking the buckets (rather than tracking a
 * single "minFrequency" integer) keeps delete and expiry O(1) too.
 */
export class LFUCache<K, V> implements Cache<K, V> {
  readonly capacity: number;
  private readonly index = new Map<K, LfuNode<K, V>>();
  private readonly buckets = new DoublyLinkedList<FrequencyBucket<K, V>>();
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
    this.promote(node);
    return node.value.value;
  }

  peek(key: K): V | undefined {
    return this.liveNode(key)?.value.value;
  }

  has(key: K): boolean {
    return this.liveNode(key) !== undefined;
  }

  /** How many times the key has been used (0 if absent). An update counts as a use. */
  frequency(key: K): number {
    return this.liveNode(key)?.value.bucket.value.frequency ?? 0;
  }

  put(key: K, value: V, options: PutOptions = {}): void {
    const expiresAt = this.expiry.expiresAt(options.ttlMs);
    const existing = this.liveNode(key);
    if (existing) {
      existing.value.value = value;
      existing.value.expiresAt = expiresAt;
      this.promote(existing);
      return;
    }
    if (this.capacity === 0) {
      this.onEvict?.(key, value, EvictionReason.CAPACITY);
      return;
    }
    if (this.index.size >= this.capacity) this.evictVictim();
    const bucket = this.bucketAfter(null, 1);
    const node = new ListNode<LfuEntry<K, V>>({ key, value, expiresAt, bucket });
    bucket.value.entries.pushFront(node);
    this.index.set(key, node);
  }

  delete(key: K): boolean {
    const node = this.liveNode(key);
    if (!node) return false;
    this.unlink(node);
    return true;
  }

  /** Highest frequency first, most recent first within a frequency: the reverse of eviction order. */
  keys(): K[] {
    const live: K[] = [];
    for (const bucket of this.buckets.nodes().reverse()) {
      for (const node of bucket.value.entries.nodes()) {
        if (this.expiry.isExpired(node.value.expiresAt)) this.evict(node, EvictionReason.EXPIRED);
        else live.push(node.value.key);
      }
    }
    return live;
  }

  clear(): void {
    this.index.clear();
    this.buckets.clear();
  }

  private liveNode(key: K): LfuNode<K, V> | undefined {
    const node = this.index.get(key);
    if (!node) return undefined;
    if (this.expiry.isExpired(node.value.expiresAt)) {
      this.evict(node, EvictionReason.EXPIRED);
      return undefined;
    }
    return node;
  }

  /** Moves the entry to the bucket for frequency + 1, creating it right after the current one if needed. */
  private promote(node: LfuNode<K, V>): void {
    const current = node.value.bucket;
    const target = this.bucketAfter(current, current.value.frequency + 1);
    current.value.entries.remove(node);
    if (current.value.entries.size === 0) this.buckets.remove(current);
    target.value.entries.pushFront(node);
    node.value.bucket = target;
  }

  /** The bucket for `frequency` directly after `anchor` (or at the front when anchor is null). */
  private bucketAfter(anchor: BucketNode<K, V> | null, frequency: number): BucketNode<K, V> {
    const candidate = anchor ? anchor.next : this.buckets.first;
    if (candidate && candidate.value.frequency === frequency) return candidate;
    const bucket = new ListNode<FrequencyBucket<K, V>>({
      frequency,
      entries: new DoublyLinkedList<LfuEntry<K, V>>(),
    });
    if (anchor) this.buckets.insertAfter(anchor, bucket);
    else this.buckets.pushFront(bucket);
    return bucket;
  }

  private evictVictim(): void {
    const victim = this.buckets.first?.value.entries.last;
    if (!victim) return;
    const expired = this.expiry.isExpired(victim.value.expiresAt);
    this.evict(victim, expired ? EvictionReason.EXPIRED : EvictionReason.CAPACITY);
  }

  private evict(node: LfuNode<K, V>, reason: EvictionReason): void {
    this.unlink(node);
    this.onEvict?.(node.value.key, node.value.value, reason);
  }

  private unlink(node: LfuNode<K, V>): void {
    const bucket = node.value.bucket;
    bucket.value.entries.remove(node);
    if (bucket.value.entries.size === 0) this.buckets.remove(bucket);
    this.index.delete(node.value.key);
  }
}
