import type { Clock } from '../shared/clock';
import { SeatLockedByAnotherUserError, SeatLockExpiredError, SeatUnavailableError } from './errors';
import type { Show } from './show';

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  LOCKED = 'LOCKED',
  BOOKED = 'BOOKED',
}

export interface SeatLock {
  showId: string;
  seatId: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Holds seats for a user while they pay. Expiry is evaluated lazily against the
 * Clock whenever a lock is read, so no timer is needed: a lock past its TTL is
 * simply treated as absent (exactly how a Redis key with a TTL behaves).
 */
export class SeatLockService {
  private readonly locks = new Map<string, SeatLock>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
  ) {}

  statusOf(show: Show, seatId: string): SeatStatus {
    if (show.isBooked(seatId)) return SeatStatus.BOOKED;
    return this.liveLock(show.id, seatId) ? SeatStatus.LOCKED : SeatStatus.AVAILABLE;
  }

  /** Locks every seat or none. Re-locking your own seats refreshes the TTL. */
  lock(show: Show, seatIds: string[], userId: string): Date {
    for (const seatId of seatIds) {
      show.screen.seat(seatId);
      if (show.isBooked(seatId)) throw new SeatUnavailableError(seatId, SeatStatus.BOOKED);
      const existing = this.liveLock(show.id, seatId);
      if (existing && existing.userId !== userId) throw new SeatUnavailableError(seatId, SeatStatus.LOCKED);
    }
    const expiresAt = new Date(this.clock.now().getTime() + this.ttlSeconds * 1_000);
    for (const seatId of seatIds) this.locks.set(key(show.id, seatId), { showId: show.id, seatId, userId, expiresAt });
    return expiresAt;
  }

  /** The check made right before charging money: every seat must still be held by this user. */
  assertHeldBy(show: Show, seatIds: string[], userId: string): void {
    for (const seatId of seatIds) {
      const lock = this.liveLock(show.id, seatId);
      if (lock && lock.userId !== userId) throw new SeatLockedByAnotherUserError(seatId);
      if (!lock) throw new SeatLockExpiredError(seatId, userId);
    }
  }

  /** Releases only locks this user holds, so a stale release cannot free someone else's seat. */
  release(show: Show, seatIds: string[], userId: string): void {
    for (const seatId of seatIds) {
      const k = key(show.id, seatId);
      if (this.locks.get(k)?.userId === userId) this.locks.delete(k);
    }
  }

  private liveLock(showId: string, seatId: string): SeatLock | undefined {
    const k = key(showId, seatId);
    const lock = this.locks.get(k);
    if (lock && this.clock.now().getTime() >= lock.expiresAt.getTime()) {
      this.locks.delete(k);
      return undefined;
    }
    return lock;
  }
}

function key(showId: string, seatId: string): string {
  return `${showId}:${seatId}`;
}
