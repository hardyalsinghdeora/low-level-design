import type { Clock } from '../shared/clock';
import type { IdGenerator } from '../shared/id-generator';
import { EventStatus, type ConcertEvent } from './concert-event';
import { OfferExpiredError, OfferNotFoundError } from './errors';
import type { Allocation, TicketTier } from './ticket-category';

export enum OfferStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  WITHDRAWN = 'WITHDRAWN',
}

export interface WaitlistEntry {
  userId: string;
  eventId: string;
  tier: TicketTier;
  quantity: number;
  joinedAt: Date;
}

/** Stock held for one waitlisted user until `expiresAt`. Nobody else can buy it meanwhile. */
export class Offer {
  private current = OfferStatus.PENDING;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly event: ConcertEvent,
    readonly allocation: Allocation,
    readonly expiresAt: Date,
  ) {}

  get status(): OfferStatus {
    return this.current;
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  close(to: OfferStatus.ACCEPTED | OfferStatus.EXPIRED | OfferStatus.WITHDRAWN): void {
    if (this.current !== OfferStatus.PENDING) throw new OfferNotFoundError(this.id);
    this.current = to;
  }
}

/** Observer of freed inventory. The waitlist is one subscriber; analytics could be another. */
export interface InventoryListener {
  onInventoryReleased(event: ConcertEvent, tier: TicketTier): void;
}

/** Observer of offers, e.g. an email or push sender. */
export interface OfferListener {
  onOfferMade(offer: Offer): void;
}

/**
 * Strict FIFO waitlist per (event, tier). When stock is released it holds stock
 * for the head of the queue as an Offer; if the head wants more than is free,
 * nobody behind them jumps the queue.
 */
export class WaitlistManager implements InventoryListener {
  private readonly queues = new Map<string, WaitlistEntry[]>();
  private readonly offers = new Map<string, Offer>();
  private readonly listeners: OfferListener[] = [];

  constructor(
    private readonly offerTtlMinutes: number,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  subscribe(listener: OfferListener): void {
    this.listeners.push(listener);
  }

  join(entry: WaitlistEntry): number {
    const queue = this.queue(entry.eventId, entry.tier);
    queue.push(entry);
    return queue.length;
  }

  waiting(eventId: string, tier: TicketTier): readonly WaitlistEntry[] {
    return this.queue(eventId, tier);
  }

  pendingOffersFor(userId: string, eventId: string): Offer[] {
    return [...this.offers.values()].filter(
      (o) => o.userId === userId && o.event.id === eventId && o.status === OfferStatus.PENDING,
    );
  }

  onInventoryReleased(event: ConcertEvent, tier: TicketTier): void {
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.COMPLETED) return;
    const queue = this.queue(event.id, tier);
    const category = event.category(tier);
    while (queue.length > 0 && category.available >= queue[0].quantity) {
      const [entry] = queue.splice(0, 1);
      const allocation = category.allocate({ quantity: entry.quantity });
      const expiresAt = new Date(this.clock.now().getTime() + this.offerTtlMinutes * 60_000);
      const offer = new Offer(this.ids.next('OFR'), entry.userId, event, allocation, expiresAt);
      this.offers.set(offer.id, offer);
      for (const listener of this.listeners) listener.onOfferMade(offer);
    }
    event.refreshAvailability();
  }

  /** Returns a live offer for this user, or expires it (passing stock on) and throws. */
  pendingOffer(offerId: string, userId: string): Offer {
    const offer = this.offers.get(offerId);
    if (!offer || offer.userId !== userId || offer.status !== OfferStatus.PENDING) throw new OfferNotFoundError(offerId);
    if (offer.isExpired(this.clock.now())) {
      this.expire(offer);
      throw new OfferExpiredError(offerId);
    }
    return offer;
  }

  /** Explicit time step: expire every overdue offer and offer its stock to the next in line. */
  tick(): Offer[] {
    const now = this.clock.now();
    const overdue = [...this.offers.values()].filter((o) => o.status === OfferStatus.PENDING && o.isExpired(now));
    for (const offer of overdue) this.expire(offer);
    return overdue;
  }

  withdrawAll(eventId: string): void {
    for (const offer of this.offers.values()) {
      if (offer.event.id === eventId && offer.status === OfferStatus.PENDING) offer.close(OfferStatus.WITHDRAWN);
    }
    for (const key of this.queues.keys()) if (key.startsWith(`${eventId}:`)) this.queues.delete(key);
  }

  private expire(offer: Offer): void {
    offer.close(OfferStatus.EXPIRED);
    offer.event.category(offer.allocation.tier).release(offer.allocation);
    this.onInventoryReleased(offer.event, offer.allocation.tier);
  }

  private queue(eventId: string, tier: TicketTier): WaitlistEntry[] {
    const key = `${eventId}:${tier}`;
    let queue = this.queues.get(key);
    if (!queue) {
      queue = [];
      this.queues.set(key, queue);
    }
    return queue;
  }
}
