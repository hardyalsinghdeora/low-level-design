import type { Money } from '../shared/money';
import { BidTooLowError } from './errors';
import type { IncrementPolicy } from './strategies/increment-policy';

/** A bidder's standing instruction: "bid for me, up to maxAmount". */
export interface Bid {
  readonly bidderId: string;
  readonly maxAmount: Money;
  readonly placedAt: Date;
  /** Arrival order within the auction. On equal maximums the earlier bid wins. */
  readonly sequence: number;
}

export interface BidResolution {
  readonly leaderId: string;
  readonly currentPrice: Money;
  /** Who just lost: the previous leader, or a newcomer beaten at once by the leader's proxy. */
  readonly outbidUserId: string | null;
}

/**
 * Proxy bidding with eBay semantics. Each bidder states a maximum; the leader
 * pays one increment over the runner-up's maximum, never more than their own.
 * Kept apart from Auction so the price arithmetic is small and testable alone.
 */
export class ProxyBidBook {
  private leader: Bid | null = null;
  private price: Money;
  private readonly history: Bid[] = [];

  constructor(
    private readonly startingPrice: Money,
    private readonly reservePrice: Money,
    private readonly increments: IncrementPolicy,
  ) {
    this.price = startingPrice;
  }

  get currentPrice(): Money {
    return this.price;
  }

  get leadingBid(): Bid | null {
    return this.leader;
  }

  get bids(): readonly Bid[] {
    return this.history;
  }

  get reserveMet(): boolean {
    return this.leader !== null && this.price >= this.reservePrice;
  }

  /** The smallest maximum a challenger may submit right now. */
  minimumBid(): Money {
    return this.leader ? this.price + this.increments.incrementAt(this.price) : this.startingPrice;
  }

  place(bid: Bid): BidResolution {
    const leader = this.leader;
    if (leader?.bidderId === bid.bidderId) return this.raiseLeaderMaximum(leader, bid);
    const minimum = this.minimumBid();
    if (bid.maxAmount < minimum) throw new BidTooLowError(bid.maxAmount, minimum);
    this.history.push(bid);

    let outbidUserId: string | null = null;
    if (leader === null) {
      this.leader = bid; // the opening bid shows the starting price, not the maximum
    } else if (bid.maxAmount > leader.maxAmount) {
      this.leader = bid;
      this.price = Math.min(bid.maxAmount, leader.maxAmount + this.increments.incrementAt(leader.maxAmount));
      outbidUserId = leader.bidderId;
    } else {
      // The leader's proxy answers for them. A tie goes to the earlier bid, i.e. the leader.
      this.price = Math.min(leader.maxAmount, bid.maxAmount + this.increments.incrementAt(bid.maxAmount));
      outbidUserId = bid.bidderId;
    }
    this.applyReserveRule();
    return { leaderId: this.requireLeader().bidderId, currentPrice: this.price, outbidUserId };
  }

  /** Raising your own maximum never raises the price you show: nobody is bidding against you. */
  private raiseLeaderMaximum(leader: Bid, bid: Bid): BidResolution {
    if (bid.maxAmount <= leader.maxAmount) throw new BidTooLowError(bid.maxAmount, leader.maxAmount + 1);
    this.history.push(bid);
    this.leader = bid;
    this.applyReserveRule();
    return { leaderId: bid.bidderId, currentPrice: this.price, outbidUserId: null };
  }

  /** eBay rule: once the leading maximum covers the reserve, the visible price jumps to the reserve. */
  private applyReserveRule(): void {
    const leader = this.requireLeader();
    if (leader.maxAmount >= this.reservePrice && this.price < this.reservePrice) this.price = this.reservePrice;
  }

  private requireLeader(): Bid {
    if (!this.leader) throw new RangeError('no leading bid');
    return this.leader;
  }
}
