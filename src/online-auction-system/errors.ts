import { DomainError } from '../shared/errors';
import { formatMoney, type Money } from '../shared/money';
import type { AuctionStatus } from './auction';

export class AuctionError extends DomainError {}

export class AuctionNotFoundError extends AuctionError {
  constructor(auctionId: string) {
    super(`No auction ${auctionId}`);
  }
}

export class InvalidAuctionScheduleError extends AuctionError {
  constructor(reason: string) {
    super(`Invalid auction schedule: ${reason}`);
  }
}

export class AuctionNotActiveError extends AuctionError {
  constructor(auctionId: string, status: AuctionStatus) {
    super(`Auction ${auctionId} is ${status}, bids are not accepted`);
  }
}

export class SellerCannotBidError extends AuctionError {
  constructor(auctionId: string) {
    super(`The seller cannot bid on their own auction ${auctionId}`);
  }
}

export class BidTooLowError extends AuctionError {
  constructor(
    readonly amount: Money,
    readonly minimum: Money,
  ) {
    super(`Bid ${formatMoney(amount)} is below the minimum ${formatMoney(minimum)}`);
  }
}

export class InvalidAuctionTransitionError extends AuctionError {
  constructor(auctionId: string, from: AuctionStatus, to: AuctionStatus) {
    super(`Auction ${auctionId} cannot go from ${from} to ${to}`);
  }
}
