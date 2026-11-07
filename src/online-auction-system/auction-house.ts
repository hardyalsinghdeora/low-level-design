import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { Auction, AuctionStatus, type BidReceipt } from './auction';
import type { AuctionEvent, AuctionObserver } from './auction-events';
import { AuctionNotFoundError } from './errors';
import { FixedIncrement, type IncrementPolicy } from './strategies/increment-policy';
import { HardClose, type SoftClosePolicy } from './strategies/soft-close-policy';

export interface CreateAuctionInput {
  sellerId: string;
  title: string;
  startingPrice: Money;
  reservePrice?: Money;
  startAt: Date;
  endAt: Date;
  increments?: IncrementPolicy;
  softClose?: SoftClosePolicy;
}

export interface AuctionHouseOptions {
  clock?: Clock;
  ids?: IdGenerator;
  /** House defaults, overridable per auction. */
  increments?: IncrementPolicy;
  softClose?: SoftClosePolicy;
}

/**
 * Application service. Creates auctions with house defaults, stamps every
 * command with the clock's time, and relays every auction's events to the
 * house observers, so subscribers do not need to know which lots exist.
 */
export class AuctionHouse {
  private readonly auctions = new Map<string, Auction>();
  private readonly observers: AuctionObserver[] = [];
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly increments: IncrementPolicy;
  private readonly softClose: SoftClosePolicy;

  constructor(options: AuctionHouseOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.increments = options.increments ?? new FixedIncrement(10_000);
    this.softClose = options.softClose ?? new HardClose();
  }

  subscribe(observer: AuctionObserver): void {
    this.observers.push(observer);
  }

  createAuction(input: CreateAuctionInput): Auction {
    const auction = new Auction({
      id: this.ids.next('AUC'),
      sellerId: input.sellerId,
      title: input.title,
      startingPrice: input.startingPrice,
      reservePrice: input.reservePrice ?? 0,
      startAt: input.startAt,
      endAt: input.endAt,
      increments: input.increments ?? this.increments,
      softClose: input.softClose ?? this.softClose,
    });
    auction.subscribe({ onAuctionEvent: (event: AuctionEvent) => this.relay(event) });
    auction.syncWithClock(this.clock.now());
    this.auctions.set(auction.id, auction);
    return auction;
  }

  placeBid(auctionId: string, bidderId: string, maxAmount: Money): BidReceipt {
    return this.getAuction(auctionId).placeBid(bidderId, maxAmount, this.clock.now());
  }

  cancel(auctionId: string): Auction {
    const auction = this.getAuction(auctionId);
    auction.cancel(this.clock.now());
    return auction;
  }

  /** What a scheduler calls every minute. The domain never sets timers; it reacts to the clock. */
  closeExpired(): Auction[] {
    const now = this.clock.now();
    const closed: Auction[] = [];
    for (const auction of this.auctions.values()) {
      const before = auction.status;
      auction.syncWithClock(now);
      if (before !== AuctionStatus.ENDED && auction.status === AuctionStatus.ENDED) closed.push(auction);
    }
    return closed;
  }

  getAuction(auctionId: string): Auction {
    const auction = this.auctions.get(auctionId);
    if (!auction) throw new AuctionNotFoundError(auctionId);
    return auction;
  }

  private relay(event: AuctionEvent): void {
    for (const observer of this.observers) observer.onAuctionEvent(event);
  }
}
