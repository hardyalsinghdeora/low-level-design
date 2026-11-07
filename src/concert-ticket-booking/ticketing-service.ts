import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import type { ConcertEvent } from './concert-event';
import {
  CategoryNotSoldOutError,
  EventNotFoundError,
  InvalidOrderError,
  OrderNotCancellableError,
  OrderNotFoundError,
  PurchaseLimitExceededError,
} from './errors';
import { Order, OrderStatus, type OrderLine } from './order';
import { TieredRefundPolicy, type RefundPolicy } from './strategies/refund';
import type { Allocation, TicketTier } from './ticket-category';
import { OfferStatus, WaitlistManager, type InventoryListener, type OfferListener, type WaitlistEntry } from './waitlist';

export interface OrderRequestLine {
  tier: TicketTier;
  quantity: number;
  seatIds?: string[];
}

export interface TicketingOptions {
  refundPolicy?: RefundPolicy;
  offerTtlMinutes?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Facade over events, orders and waitlists. Orders are atomic by compensation:
 * each line is allocated in turn and, if any line fails, the earlier ones are
 * released before the error propagates.
 */
export class TicketingService {
  private readonly events = new Map<string, ConcertEvent>();
  private readonly orders = new Map<string, Order>();
  private readonly inventoryListeners: InventoryListener[] = [];
  private readonly waitlist: WaitlistManager;
  private readonly refundPolicy: RefundPolicy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: TicketingOptions = {}) {
    this.refundPolicy = options.refundPolicy ?? new TieredRefundPolicy();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.waitlist = new WaitlistManager(options.offerTtlMinutes ?? 30, this.clock, this.ids);
    this.inventoryListeners.push(this.waitlist);
  }

  addEvent(event: ConcertEvent): this {
    this.events.set(event.id, event);
    return this;
  }

  onOffer(listener: OfferListener): void {
    this.waitlist.subscribe(listener);
  }

  openSales(eventId: string): void {
    this.event(eventId).openSales();
  }

  ticketsHeld(userId: string, eventId: string): number {
    return [...this.orders.values()]
      .filter((o) => o.userId === userId && o.event.id === eventId && o.status === OrderStatus.CONFIRMED)
      .reduce((sum, o) => sum + o.ticketCount, 0);
  }

  placeOrder(userId: string, eventId: string, request: OrderRequestLine[]): Order {
    const event = this.event(eventId);
    event.assertOnSale();
    if (request.length === 0) throw new InvalidOrderError('An order needs at least one line');
    if (new Set(request.map((l) => l.tier)).size !== request.length) throw new InvalidOrderError('One line per tier');
    this.assertWithinLimit(userId, event, request.reduce((sum, l) => sum + l.quantity, 0));

    const allocated: Allocation[] = [];
    try {
      for (const line of request) allocated.push(event.category(line.tier).allocate(line));
    } catch (error) {
      for (const a of allocated) event.category(a.tier).release(a);
      throw error;
    }
    event.refreshAvailability();
    return this.recordOrder(userId, event, allocated);
  }

  joinWaitlist(userId: string, eventId: string, tier: TicketTier, quantity: number): number {
    const event = this.event(eventId);
    if (event.category(tier).available >= quantity) throw new CategoryNotSoldOutError(tier);
    this.assertWithinLimit(userId, event, quantity);
    const entry: WaitlistEntry = { userId, eventId, tier, quantity, joinedAt: this.clock.now() };
    return this.waitlist.join(entry);
  }

  waitlistFor(eventId: string, tier: TicketTier): readonly WaitlistEntry[] {
    return this.waitlist.waiting(eventId, tier);
  }

  pendingOffers(userId: string, eventId: string) {
    return this.waitlist.pendingOffersFor(userId, eventId);
  }

  acceptOffer(offerId: string, userId: string): Order {
    const offer = this.waitlist.pendingOffer(offerId, userId);
    this.assertWithinLimit(userId, offer.event, offer.allocation.quantity);
    offer.close(OfferStatus.ACCEPTED);
    return this.recordOrder(userId, offer.event, [offer.allocation]);
  }

  /** Explicit time step for offer expiry (no timers in the domain). */
  tick(): number {
    return this.waitlist.tick().length;
  }

  cancelOrder(orderId: string, userId: string): Money {
    const order = this.orders.get(orderId);
    if (!order || order.userId !== userId) throw new OrderNotFoundError(orderId);
    const now = this.clock.now();
    if (now.getTime() >= order.event.startsAt.getTime()) throw new OrderNotCancellableError(orderId);
    const refund = this.refundPolicy.refundFor(order, now);
    order.cancel(refund);
    this.returnStock(order);
    return refund;
  }

  /** Organiser cancels: every order is refunded in full and the waitlist is dropped. */
  cancelEvent(eventId: string): Money {
    const event = this.event(eventId);
    event.cancel();
    this.waitlist.withdrawAll(eventId);
    let refunded = 0;
    for (const order of this.orders.values()) {
      if (order.event.id === eventId && order.status === OrderStatus.CONFIRMED) {
        order.cancel(order.total);
        refunded += order.total;
      }
    }
    return refunded;
  }

  private returnStock(order: Order): void {
    const { event } = order;
    for (const line of order.lines) event.category(line.tier).release(line);
    event.refreshAvailability();
    for (const line of order.lines) {
      for (const listener of this.inventoryListeners) listener.onInventoryReleased(event, line.tier);
    }
  }

  private recordOrder(userId: string, event: ConcertEvent, allocations: Allocation[]): Order {
    const lines: OrderLine[] = allocations.map((a) => ({ ...a, unitPrice: event.category(a.tier).price }));
    const order = new Order(this.ids.next('ORD'), userId, event, lines, this.clock.now());
    this.orders.set(order.id, order);
    return order;
  }

  private assertWithinLimit(userId: string, event: ConcertEvent, extra: number): void {
    const wouldHold = this.ticketsHeld(userId, event.id) + extra;
    if (wouldHold > event.perUserLimit) throw new PurchaseLimitExceededError(userId, event.perUserLimit, wouldHold);
  }

  private event(id: string): ConcertEvent {
    const event = this.events.get(id);
    if (!event) throw new EventNotFoundError(id);
    return event;
  }
}
