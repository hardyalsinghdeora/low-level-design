import { assertMoney, type Money } from '../shared/money';
import { AuctionEventType, type AuctionEvent, type AuctionObserver } from './auction-events';
import {
  AuctionNotActiveError,
  InvalidAuctionScheduleError,
  InvalidAuctionTransitionError,
  SellerCannotBidError,
} from './errors';
import { ProxyBidBook, type Bid } from './proxy-bid-book';
import type { IncrementPolicy } from './strategies/increment-policy';
import type { SoftClosePolicy } from './strategies/soft-close-policy';

export enum AuctionStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

export enum AuctionOutcome {
  SOLD = 'SOLD',
  RESERVE_NOT_MET = 'RESERVE_NOT_MET',
  NO_BIDS = 'NO_BIDS',
}

export interface AuctionResult {
  readonly outcome: AuctionOutcome;
  readonly winnerId: string | null;
  readonly finalPrice: Money | null;
}

const ALLOWED_TRANSITIONS: Record<AuctionStatus, readonly AuctionStatus[]> = {
  [AuctionStatus.SCHEDULED]: [AuctionStatus.ACTIVE, AuctionStatus.CANCELLED],
  [AuctionStatus.ACTIVE]: [AuctionStatus.ENDED, AuctionStatus.CANCELLED],
  [AuctionStatus.ENDED]: [],
  [AuctionStatus.CANCELLED]: [],
};

export interface AuctionProps {
  id: string;
  sellerId: string;
  title: string;
  startingPrice: Money;
  /** Lowest price the seller will accept. 0 means no reserve. */
  reservePrice: Money;
  startAt: Date;
  endAt: Date;
  increments: IncrementPolicy;
  softClose: SoftClosePolicy;
}

export interface BidReceipt {
  readonly auctionId: string;
  readonly bidderId: string;
  readonly isLeading: boolean;
  readonly leaderId: string;
  readonly currentPrice: Money;
  readonly endsAt: Date;
}

/**
 * Aggregate root for one lot. Its status is stored but driven by the clock:
 * every command calls `syncWithClock(now)` first, so the auction ends exactly
 * at its end time although no timer runs in the domain.
 */
export class Auction {
  readonly id: string;
  readonly sellerId: string;
  readonly title: string;
  readonly startAt: Date;
  readonly reservePrice: Money;
  private _endAt: Date;
  private _status = AuctionStatus.SCHEDULED;
  private _result: AuctionResult | null = null;
  private readonly book: ProxyBidBook;
  private readonly softClose: SoftClosePolicy;
  private readonly observers: AuctionObserver[] = [];
  private sequence = 0;

  constructor(props: AuctionProps) {
    if (props.endAt.getTime() <= props.startAt.getTime()) {
      throw new InvalidAuctionScheduleError(`end ${props.endAt.toISOString()} must be after start ${props.startAt.toISOString()}`);
    }
    assertMoney(props.startingPrice, 'startingPrice');
    assertMoney(props.reservePrice, 'reservePrice');
    this.id = props.id;
    this.sellerId = props.sellerId;
    this.title = props.title;
    this.startAt = props.startAt;
    this.reservePrice = props.reservePrice;
    this._endAt = props.endAt;
    this.softClose = props.softClose;
    this.book = new ProxyBidBook(props.startingPrice, props.reservePrice, props.increments);
  }

  get status(): AuctionStatus {
    return this._status;
  }

  get endAt(): Date {
    return this._endAt;
  }

  get currentPrice(): Money {
    return this.book.currentPrice;
  }

  get leaderId(): string | null {
    return this.book.leadingBid?.bidderId ?? null;
  }

  get bids(): readonly Bid[] {
    return this.book.bids;
  }

  get result(): AuctionResult | null {
    return this._result;
  }

  minimumBid(): Money {
    return this.book.minimumBid();
  }

  subscribe(observer: AuctionObserver): void {
    this.observers.push(observer);
  }

  /** SCHEDULED -> ACTIVE at startAt, ACTIVE -> ENDED at endAt. Idempotent; safe to call on every read. */
  syncWithClock(now: Date): void {
    if (this._status === AuctionStatus.SCHEDULED && now.getTime() >= this.startAt.getTime()) {
      this.moveTo(AuctionStatus.ACTIVE);
    }
    if (this._status === AuctionStatus.ACTIVE && now.getTime() >= this._endAt.getTime()) {
      this.moveTo(AuctionStatus.ENDED);
      this._result = this.determineResult();
      this.publish({ type: AuctionEventType.ENDED, auctionId: this.id, sellerId: this.sellerId, result: this._result });
    }
  }

  placeBid(bidderId: string, maxAmount: Money, now: Date): BidReceipt {
    this.syncWithClock(now);
    if (this._status !== AuctionStatus.ACTIVE) throw new AuctionNotActiveError(this.id, this._status);
    if (bidderId === this.sellerId) throw new SellerCannotBidError(this.id);
    assertMoney(maxAmount, 'maxAmount');

    const resolution = this.book.place({ bidderId, maxAmount, placedAt: now, sequence: this.sequence + 1 });
    this.sequence += 1;
    const { leaderId, currentPrice, outbidUserId } = resolution;
    if (outbidUserId) this.publish({ type: AuctionEventType.OUTBID, auctionId: this.id, userId: outbidUserId, currentPrice });
    this.publish({ type: AuctionEventType.BID_PLACED, auctionId: this.id, sellerId: this.sellerId, leaderId, currentPrice });

    const newEnd = this.softClose.endTimeAfterBid(this._endAt, now);
    if (newEnd.getTime() > this._endAt.getTime()) {
      this._endAt = newEnd;
      this.publish({ type: AuctionEventType.EXTENDED, auctionId: this.id, endsAt: newEnd });
    }
    return { auctionId: this.id, bidderId, isLeading: leaderId === bidderId, leaderId, currentPrice, endsAt: this._endAt };
  }

  cancel(now: Date): void {
    this.syncWithClock(now);
    this.moveTo(AuctionStatus.CANCELLED);
    this.publish({ type: AuctionEventType.CANCELLED, auctionId: this.id, sellerId: this.sellerId });
  }

  private determineResult(): AuctionResult {
    const leader = this.book.leadingBid;
    if (!leader) return { outcome: AuctionOutcome.NO_BIDS, winnerId: null, finalPrice: null };
    if (!this.book.reserveMet) return { outcome: AuctionOutcome.RESERVE_NOT_MET, winnerId: null, finalPrice: null };
    return { outcome: AuctionOutcome.SOLD, winnerId: leader.bidderId, finalPrice: this.book.currentPrice };
  }

  private moveTo(next: AuctionStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidAuctionTransitionError(this.id, this._status, next);
    }
    this._status = next;
  }

  private publish(event: AuctionEvent): void {
    for (const observer of this.observers) observer.onAuctionEvent(event);
  }
}
