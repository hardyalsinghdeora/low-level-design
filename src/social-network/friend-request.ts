import { InvalidFriendRequestTransitionError } from './errors';

export enum FriendRequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/** A request is answered exactly once; both outcomes are terminal. */
const TRANSITIONS: Record<FriendRequestStatus, readonly FriendRequestStatus[]> = {
  [FriendRequestStatus.PENDING]: [FriendRequestStatus.ACCEPTED, FriendRequestStatus.REJECTED],
  [FriendRequestStatus.ACCEPTED]: [],
  [FriendRequestStatus.REJECTED]: [],
};

/**
 * The handshake that precedes a friendship. It only records the decision;
 * creating the symmetric friendship is SocialGraph's job, triggered by the
 * service after a successful accept().
 */
export class FriendRequest {
  private _status = FriendRequestStatus.PENDING;
  private _respondedAt: Date | null = null;

  constructor(
    readonly id: string,
    readonly fromId: string,
    readonly toId: string,
    readonly createdAt: Date,
  ) {}

  get status(): FriendRequestStatus {
    return this._status;
  }

  get respondedAt(): Date | null {
    return this._respondedAt;
  }

  /** True for a pending request in either direction between the two users. */
  isPendingBetween(a: string, b: string): boolean {
    const sameUsers = (this.fromId === a && this.toId === b) || (this.fromId === b && this.toId === a);
    return sameUsers && this._status === FriendRequestStatus.PENDING;
  }

  accept(at: Date): void {
    this.transitionTo(FriendRequestStatus.ACCEPTED, at);
  }

  reject(at: Date): void {
    this.transitionTo(FriendRequestStatus.REJECTED, at);
  }

  private transitionTo(next: FriendRequestStatus, at: Date): void {
    if (!TRANSITIONS[this._status].includes(next)) {
      throw new InvalidFriendRequestTransitionError(this.id, this._status, next);
    }
    this._status = next;
    this._respondedAt = at;
  }
}
