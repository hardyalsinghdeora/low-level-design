import type { DomainError } from '../shared/errors';
import { IdempotencyKeyReusedError } from './errors';

/** The response we gave for a key: the transaction it created and, if it failed, the error. */
export interface IdempotencyRecord {
  key: string;
  /** Canonical request body. The same key with a different body is a client bug. */
  fingerprint: string;
  transactionId: string;
  error: DomainError | null;
}

/**
 * Remembers the outcome of every keyed request so a retry (timeout, double
 * tap, queue redelivery) gets the original answer instead of moving money
 * twice. In a database this is a table with a UNIQUE key, written in the same
 * database transaction as the ledger entries.
 */
export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  /** The stored outcome for `key`, or undefined when the key is new. */
  lookup(key: string, fingerprint: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (record && record.fingerprint !== fingerprint) throw new IdempotencyKeyReusedError(key);
    return record;
  }

  save(key: string, fingerprint: string, transactionId: string, error: DomainError | null = null): void {
    // The unique constraint: a key is written exactly once.
    if (this.records.has(key)) throw new IdempotencyKeyReusedError(key);
    this.records.set(key, { key, fingerprint, transactionId, error });
  }
}
