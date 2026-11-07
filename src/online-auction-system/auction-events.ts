import { formatMoney, type Money } from '../shared/money';
import type { AuctionResult } from './auction';

export enum AuctionEventType {
  BID_PLACED = 'BID_PLACED',
  OUTBID = 'OUTBID',
  EXTENDED = 'EXTENDED',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

export type AuctionEvent =
  | { type: AuctionEventType.BID_PLACED; auctionId: string; sellerId: string; leaderId: string; currentPrice: Money }
  | { type: AuctionEventType.OUTBID; auctionId: string; userId: string; currentPrice: Money }
  | { type: AuctionEventType.EXTENDED; auctionId: string; endsAt: Date }
  | { type: AuctionEventType.ENDED; auctionId: string; sellerId: string; result: AuctionResult }
  | { type: AuctionEventType.CANCELLED; auctionId: string; sellerId: string };

/** Observer pattern: auctions publish, and email, push or websockets subscribe without the auction knowing them. */
export interface AuctionObserver {
  onAuctionEvent(event: AuctionEvent): void;
}

export interface Notification {
  readonly userId: string;
  readonly message: string;
}

/**
 * Turns auction events into messages for the people who care: the outbid
 * bidder, the seller and the winner. Production would enqueue push or email;
 * this one keeps an inbox so tests and the demo can read it.
 */
export class InMemoryNotifier implements AuctionObserver {
  private readonly sent: Notification[] = [];

  onAuctionEvent(event: AuctionEvent): void {
    switch (event.type) {
      case AuctionEventType.OUTBID:
        this.send(event.userId, `Outbid on ${event.auctionId}, price is now ${formatMoney(event.currentPrice)}`);
        break;
      case AuctionEventType.BID_PLACED:
        this.send(event.sellerId, `New bid on ${event.auctionId}, price is now ${formatMoney(event.currentPrice)}`);
        break;
      case AuctionEventType.ENDED: {
        const { outcome, winnerId, finalPrice } = event.result;
        this.send(event.sellerId, `${event.auctionId} ended: ${outcome}${winnerId ? ` to ${winnerId}` : ''}`);
        if (winnerId && finalPrice !== null) this.send(winnerId, `You won ${event.auctionId} for ${formatMoney(finalPrice)}`);
        break;
      }
      case AuctionEventType.CANCELLED:
        this.send(event.sellerId, `${event.auctionId} was cancelled`);
        break;
      case AuctionEventType.EXTENDED:
        break; // bidders watch the end time on the lot page; no personal message
    }
  }

  inbox(userId: string): string[] {
    return this.sent.filter((n) => n.userId === userId).map((n) => n.message);
  }

  private send(userId: string, message: string): void {
    this.sent.push({ userId, message });
  }
}
