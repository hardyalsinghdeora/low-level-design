import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AuctionHouse,
  AuctionNotActiveError,
  AuctionNotFoundError,
  AuctionOutcome,
  AuctionStatus,
  BidTooLowError,
  type CreateAuctionInput,
  FixedIncrement,
  InMemoryNotifier,
  InvalidAuctionScheduleError,
  InvalidAuctionTransitionError,
  SellerCannotBidError,
  SoftCloseWindow,
  type SoftClosePolicy,
  TieredIncrement,
} from './index';

const START = new Date('2026-05-01T10:00:00Z');
const END = new Date('2026-05-01T12:00:00Z');

function setup(softClose?: SoftClosePolicy) {
  const clock = new FakeClock(START);
  const notifier = new InMemoryNotifier();
  const house = new AuctionHouse({ clock, ids: new SequentialIdGenerator(), increments: new FixedIncrement(10_000), softClose });
  house.subscribe(notifier);
  const open = (overrides: Partial<CreateAuctionInput> = {}) =>
    house.createAuction({ sellerId: 'seller', title: 'Leica M6', startingPrice: 100_000, startAt: START, endAt: END, ...overrides });
  return { clock, notifier, house, open };
}

describe('bid increments', () => {
  it('needs the starting price to open, then one increment over the current price', () => {
    const { house, open } = setup();
    const { id } = open();
    expect(() => house.placeBid(id, 'alice', 99_999)).toThrow(BidTooLowError);
    expect(house.placeBid(id, 'alice', 100_000)).toMatchObject({ isLeading: true, currentPrice: 100_000 });

    const tooLow = () => house.placeBid(id, 'bob', 109_999);
    expect(tooLow).toThrow(BidTooLowError);
    expect(tooLow).toThrow(/minimum ₹1,100.00/);
    expect(house.placeBid(id, 'bob', 110_000)).toMatchObject({ isLeading: true, currentPrice: 110_000 });
  });

  it('tiered increments grow with the price', () => {
    const tiers = new TieredIncrement([
      { from: 0, increment: 5_000 },
      { from: 100_000, increment: 10_000 },
      { from: 500_000, increment: 50_000 },
    ]);
    expect([tiers.incrementAt(99_999), tiers.incrementAt(100_000), tiers.incrementAt(600_000)]).toEqual([5_000, 10_000, 50_000]);

    const { house, open } = setup();
    const auction = open({ startingPrice: 90_000, increments: tiers });
    house.placeBid(auction.id, 'alice', 90_000);
    expect(auction.minimumBid()).toBe(95_000);
    house.placeBid(auction.id, 'bob', 300_000);
    house.placeBid(auction.id, 'carol', 200_000); // bob's proxy answers at 200,000 + 10,000
    expect(auction.currentPrice).toBe(210_000);
    expect(auction.minimumBid()).toBe(220_000);
  });
});

describe('proxy bidding', () => {
  it("beats a lower challenger at once with the leader's proxy, and tells both sides", () => {
    const { house, open, notifier } = setup();
    const { id } = open();
    house.placeBid(id, 'alice', 500_000);
    const receipt = house.placeBid(id, 'bob', 300_000);

    expect(receipt).toMatchObject({ isLeading: false, leaderId: 'alice', currentPrice: 310_000 });
    expect(notifier.inbox('bob')).toEqual([`Outbid on ${id}, price is now ₹3,100.00`]);
    expect(notifier.inbox('alice')).toEqual([]);
    expect(notifier.inbox('seller')).toHaveLength(2);
  });

  it('resolves a bidding war one increment above the runner-up; ties go to the earlier bid', () => {
    const { house, open, notifier } = setup();
    const auction = open();
    house.placeBid(auction.id, 'alice', 500_000);
    house.placeBid(auction.id, 'bob', 300_000); // alice 310,000
    house.placeBid(auction.id, 'carol', 800_000); // carol 510,000
    expect([auction.leaderId, auction.currentPrice]).toEqual(['carol', 510_000]);
    house.placeBid(auction.id, 'alice', 1_000_000); // alice 810,000
    house.placeBid(auction.id, 'dave', 1_000_000); // tie: alice bid first

    expect([auction.leaderId, auction.currentPrice]).toEqual(['alice', 1_000_000]);
    for (const loser of ['alice', 'bob', 'carol', 'dave']) expect(notifier.inbox(loser)).toHaveLength(1);
  });

  it('lets the leader raise their maximum without raising the price', () => {
    const { house, open } = setup();
    const auction = open();
    house.placeBid(auction.id, 'alice', 300_000);
    house.placeBid(auction.id, 'bob', 200_000); // alice 210,000
    house.placeBid(auction.id, 'alice', 600_000);
    expect(auction.currentPrice).toBe(210_000);
    expect(() => house.placeBid(auction.id, 'alice', 600_000)).toThrow(BidTooLowError);

    house.placeBid(auction.id, 'carol', 500_000);
    expect([auction.leaderId, auction.currentPrice]).toEqual(['alice', 510_000]);
  });
});

describe('closing and winner determination', () => {
  it('reports reserve not met with no winner, and tells the seller', () => {
    const { house, open, clock, notifier } = setup();
    const auction = open({ reservePrice: 400_000 });
    house.placeBid(auction.id, 'alice', 300_000);
    clock.set(END);

    expect(house.closeExpired()).toEqual([auction]);
    expect(auction.result).toEqual({ outcome: AuctionOutcome.RESERVE_NOT_MET, winnerId: null, finalPrice: null });
    expect(notifier.inbox('seller').at(-1)).toBe(`${auction.id} ended: RESERVE_NOT_MET`);
  });

  it('jumps to the reserve once a maximum covers it, then sells to the leader', () => {
    const { house, open, clock, notifier } = setup();
    const auction = open({ reservePrice: 400_000 });
    house.placeBid(auction.id, 'alice', 450_000);
    expect(auction.currentPrice).toBe(400_000);
    house.placeBid(auction.id, 'bob', 420_000);
    clock.set(END);
    house.closeExpired();

    expect(auction.result).toEqual({ outcome: AuctionOutcome.SOLD, winnerId: 'alice', finalPrice: 430_000 });
    expect(notifier.inbox('alice')).toContain(`You won ${auction.id} for ₹4,300.00`);
  });

  it('soft close extends the end when a bid lands in the last minutes', () => {
    const { house, open, clock } = setup(new SoftCloseWindow(5));
    const auction = open();
    clock.set('2026-05-01T11:50:00Z');
    expect(house.placeBid(auction.id, 'alice', 200_000).endsAt).toEqual(END);
    clock.set('2026-05-01T11:57:00Z');
    expect(house.placeBid(auction.id, 'bob', 300_000).endsAt).toEqual(new Date('2026-05-01T12:02:00Z'));
    clock.set('2026-05-01T12:01:00Z'); // after the original end, still open
    expect(house.placeBid(auction.id, 'carol', 400_000).endsAt).toEqual(new Date('2026-05-01T12:06:00Z'));

    clock.set('2026-05-01T12:06:00Z');
    expect(() => house.placeBid(auction.id, 'dave', 900_000)).toThrow(AuctionNotActiveError);
    expect(auction.result).toMatchObject({ outcome: AuctionOutcome.SOLD, winnerId: 'carol' });
  });

  it('hard close never extends, and bids at or after the end are rejected', () => {
    const { house, open, clock } = setup();
    const auction = open();
    clock.set('2026-05-01T11:59:00Z');
    expect(house.placeBid(auction.id, 'alice', 200_000).endsAt).toEqual(END);
    clock.set(END);
    expect(() => house.placeBid(auction.id, 'bob', 300_000)).toThrow(AuctionNotActiveError);
    expect(auction.status).toBe(AuctionStatus.ENDED);
  });

  it('closes expired auctions from the clock without timers', () => {
    const { house, open, clock } = setup();
    const early = open();
    const late = open({ endAt: new Date('2026-05-01T13:00:00Z') });
    clock.set(END);
    expect(house.closeExpired()).toEqual([early]);
    expect(early.result?.outcome).toBe(AuctionOutcome.NO_BIDS);
    expect(late.status).toBe(AuctionStatus.ACTIVE);
    clock.advanceHours(1);
    expect(house.closeExpired()).toEqual([late]);
  });
});

describe('lifecycle rules', () => {
  it('rejects bids before the start and bids from the seller', () => {
    const { house, open, clock } = setup();
    const auction = open({ startAt: new Date('2026-05-01T11:00:00Z') });
    expect(auction.status).toBe(AuctionStatus.SCHEDULED);
    expect(() => house.placeBid(auction.id, 'alice', 200_000)).toThrow(AuctionNotActiveError);

    clock.set('2026-05-01T11:00:00Z');
    expect(() => house.placeBid(auction.id, 'seller', 200_000)).toThrow(SellerCannotBidError);
    expect(house.placeBid(auction.id, 'alice', 200_000).isLeading).toBe(true);
  });

  it('only cancels scheduled or active auctions', () => {
    const { house, open, clock } = setup();
    const auction = open();
    house.cancel(auction.id);
    expect(auction.status).toBe(AuctionStatus.CANCELLED);
    expect(() => house.placeBid(auction.id, 'alice', 200_000)).toThrow(AuctionNotActiveError);
    expect(() => house.cancel(auction.id)).toThrow(InvalidAuctionTransitionError);

    const ended = open();
    clock.set(END);
    expect(() => house.cancel(ended.id)).toThrow(InvalidAuctionTransitionError);
  });

  it('rejects unknown auctions and impossible schedules', () => {
    const { house, open } = setup();
    expect(() => house.placeBid('AUC-404', 'alice', 100_000)).toThrow(AuctionNotFoundError);
    expect(() => open({ endAt: START })).toThrow(InvalidAuctionScheduleError);
  });
});
