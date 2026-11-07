import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  CategoryNotSoldOutError,
  ConcertEvent,
  EventNotOnSaleError,
  EventStatus,
  FlatFeeRefundPolicy,
  GeneralAdmissionCategory,
  InsufficientInventoryError,
  InvalidEventTransitionError,
  InvalidOrderTransitionError,
  OfferExpiredError,
  OfferNotFoundError,
  OrderStatus,
  PurchaseLimitExceededError,
  ReservedSeatingCategory,
  SeatTakenError,
  TicketingService,
  TicketTier,
  type Offer,
  type RefundPolicy,
} from './index';

function build(options: { refundPolicy?: RefundPolicy; open?: boolean } = {}) {
  const clock = new FakeClock('2026-09-01T10:00:00Z');
  const ticketing = new TicketingService({ refundPolicy: options.refundPolicy, offerTtlMinutes: 30, clock, ids: new SequentialIdGenerator() });
  const offers: Offer[] = [];
  ticketing.onOffer({ onOfferMade: (offer) => offers.push(offer) });
  const event = new ConcertEvent(
    'EVT',
    'Test Gig',
    'Arena',
    new Date('2026-10-20T19:00:00Z'), // 49 days after the clock start
    [
      new ReservedSeatingCategory(TicketTier.VIP, 10_000, ['V1', 'V2']),
      new GeneralAdmissionCategory(TicketTier.PREMIUM, 5_000, 2),
      new GeneralAdmissionCategory(TicketTier.GENERAL, 3_333, 3),
    ],
    4,
  );
  ticketing.addEvent(event);
  if (options.open !== false) ticketing.openSales(event.id);
  return { clock, ticketing, offers, event };
}

describe('Orders', () => {
  it('books several tiers in one order and decrements inventory', () => {
    const { ticketing, event } = build();
    const order = ticketing.placeOrder('anil', 'EVT', [
      { tier: TicketTier.VIP, quantity: 1, seatIds: ['V2'] },
      { tier: TicketTier.GENERAL, quantity: 2 },
    ]);
    expect(order.total).toBe(10_000 + 2 * 3_333);
    expect(order.lines[0].seatIds).toEqual(['V2']);
    expect(event.category(TicketTier.VIP).available).toBe(1);
    expect(event.category(TicketTier.GENERAL).available).toBe(1);
  });

  it('is atomic: a failing line rolls back the lines already allocated', () => {
    const { ticketing, event } = build();
    ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.VIP, quantity: 1, seatIds: ['V1'] }]);
    expect(() =>
      ticketing.placeOrder('bela', 'EVT', [
        { tier: TicketTier.PREMIUM, quantity: 2 },
        { tier: TicketTier.VIP, quantity: 1, seatIds: ['V1'] },
      ]),
    ).toThrow(SeatTakenError);
    expect(event.category(TicketTier.PREMIUM).available).toBe(2);
    expect(() => ticketing.placeOrder('bela', 'EVT', [{ tier: TicketTier.GENERAL, quantity: 4 }])).toThrow(
      InsufficientInventoryError,
    );
  });

  it('enforces the per-user limit across orders', () => {
    const { ticketing } = build();
    ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.GENERAL, quantity: 3 }]);
    expect(() => ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 2 }])).toThrow(
      PurchaseLimitExceededError,
    );
    expect(ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 1 }]).ticketCount).toBe(1);
  });
});

describe('Event lifecycle', () => {
  it('sells only while ON_SALE, flips to SOLD_OUT and back, and rejects illegal transitions', () => {
    const { ticketing, event } = build({ open: false });
    expect(() => ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.GENERAL, quantity: 1 }])).toThrow(EventNotOnSaleError);
    ticketing.openSales('EVT');
    ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.VIP, quantity: 2 }, { tier: TicketTier.PREMIUM, quantity: 2 }]);
    const last = ticketing.placeOrder('bela', 'EVT', [{ tier: TicketTier.GENERAL, quantity: 3 }]);
    expect(event.status).toBe(EventStatus.SOLD_OUT);
    ticketing.cancelOrder(last.id, 'bela');
    expect(event.status).toBe(EventStatus.ON_SALE);
    event.complete();
    expect(() => event.openSales()).toThrow(InvalidEventTransitionError);
  });
});

describe('Waitlist', () => {
  it('offers freed stock to the first waitlisted user, who can accept it', () => {
    const { ticketing, offers, event } = build();
    const order = ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 2 }]);
    expect(() => ticketing.joinWaitlist('chirag', 'EVT', TicketTier.GENERAL, 1)).toThrow(CategoryNotSoldOutError);
    expect(ticketing.joinWaitlist('chirag', 'EVT', TicketTier.PREMIUM, 1)).toBe(1);
    expect(ticketing.joinWaitlist('dev', 'EVT', TicketTier.PREMIUM, 1)).toBe(2);

    ticketing.cancelOrder(order.id, 'anil');
    expect(offers.map((o) => o.userId)).toEqual(['chirag', 'dev']);
    expect(event.category(TicketTier.PREMIUM).available).toBe(0); // held for the offers
    expect(() => ticketing.acceptOffer(offers[0].id, 'dev')).toThrow(OfferNotFoundError);

    const accepted = ticketing.acceptOffer(offers[0].id, 'chirag');
    expect(accepted.ticketCount).toBe(1);
    expect(ticketing.ticketsHeld('chirag', 'EVT')).toBe(1);
  });

  it('passes an expired offer to the next user in line', () => {
    const { ticketing, offers, clock } = build();
    const order = ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 2 }]);
    ticketing.joinWaitlist('chirag', 'EVT', TicketTier.PREMIUM, 2);
    ticketing.joinWaitlist('dev', 'EVT', TicketTier.PREMIUM, 2);
    ticketing.cancelOrder(order.id, 'anil');
    expect(offers.map((o) => o.userId)).toEqual(['chirag']);

    clock.advanceMinutes(30);
    expect(() => ticketing.acceptOffer(offers[0].id, 'chirag')).toThrow(OfferExpiredError);
    expect(offers.map((o) => o.userId)).toEqual(['chirag', 'dev']);
    clock.advanceMinutes(30);
    expect(ticketing.tick()).toBe(1);
    expect(ticketing.waitlistFor('EVT', TicketTier.PREMIUM)).toHaveLength(0);
  });
});

describe('Refunds and cancellation', () => {
  it('refunds by notice given, flooring the remainder', () => {
    const { ticketing, clock } = build();
    const early = ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.GENERAL, quantity: 1 }]);
    expect(ticketing.cancelOrder(early.id, 'anil')).toBe(3_333); // 49 days out: 100%
    const mid = ticketing.placeOrder('bela', 'EVT', [{ tier: TicketTier.GENERAL, quantity: 3 }]);
    clock.set('2026-10-05T10:00:00Z'); // 15 days out: 50% of 9_999
    expect(ticketing.cancelOrder(mid.id, 'bela')).toBe(4_999);
    expect(mid.status).toBe(OrderStatus.CANCELLED);
    expect(() => ticketing.cancelOrder(mid.id, 'bela')).toThrow(InvalidOrderTransitionError);
    const late = ticketing.placeOrder('esha', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 1 }]);
    clock.set('2026-10-18T10:00:00Z');
    expect(ticketing.cancelOrder(late.id, 'esha')).toBe(0);
  });

  it('supports a flat handling-fee policy', () => {
    const { ticketing } = build({ refundPolicy: new FlatFeeRefundPolicy(500) });
    const order = ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 2 }]);
    expect(ticketing.cancelOrder(order.id, 'anil')).toBe(2 * 5_000 - 2 * 500);
  });

  it('refunds every order in full when the organiser cancels the event', () => {
    const { ticketing, event } = build();
    const a = ticketing.placeOrder('anil', 'EVT', [{ tier: TicketTier.PREMIUM, quantity: 2 }]);
    const b = ticketing.placeOrder('bela', 'EVT', [{ tier: TicketTier.VIP, quantity: 1 }]);
    ticketing.joinWaitlist('chirag', 'EVT', TicketTier.PREMIUM, 1);
    expect(ticketing.cancelEvent('EVT')).toBe(a.total + b.total);
    expect(event.status).toBe(EventStatus.CANCELLED);
    expect([a.refundedAmount, b.refundedAmount]).toEqual([10_000, 10_000]);
    expect(ticketing.waitlistFor('EVT', TicketTier.PREMIUM)).toHaveLength(0);
  });
});
