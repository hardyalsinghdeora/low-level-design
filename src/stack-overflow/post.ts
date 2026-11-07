import type { Comment, Commentable } from './comment';
import { InvalidPostTransitionError, PostDeletedError } from './errors';
import type { User } from './user';
import { VoteLedger, type ContentKind, type Votable, type VoteChange, type VoteType } from './vote';

export enum PostStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  DELETED = 'DELETED',
}

/** DELETED is terminal; a CLOSED question can be reopened. */
const TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  [PostStatus.OPEN]: [PostStatus.CLOSED, PostStatus.DELETED],
  [PostStatus.CLOSED]: [PostStatus.OPEN, PostStatus.DELETED],
  [PostStatus.DELETED]: [],
};

/**
 * What questions and answers share: lifecycle, votes and comments. Each
 * subclass adds only what differs (title and tags, or the parent question).
 */
export abstract class Post implements Votable, Commentable {
  abstract readonly kind: ContentKind;
  private _status = PostStatus.OPEN;
  private readonly ledger: VoteLedger;
  private readonly _comments: Comment[] = [];

  protected constructor(
    readonly id: string,
    readonly author: User,
    readonly body: string,
    readonly createdAt: Date,
  ) {
    if (!body.trim()) throw new RangeError('body is required');
    this.ledger = new VoteLedger(id, author.id);
  }

  get status(): PostStatus {
    return this._status;
  }

  get score(): number {
    return this.ledger.score;
  }

  get comments(): readonly Comment[] {
    return this._comments;
  }

  voteOf(userId: string): VoteType | null {
    return this.ledger.voteOf(userId);
  }

  /** Voting stays allowed on CLOSED questions (as on the real site); only DELETED posts refuse it. */
  castVote(voter: User, vote: VoteType): VoteChange {
    this.assertNotDeleted();
    return this.ledger.cast(voter.id, vote);
  }

  retractVote(voter: User): VoteChange {
    this.assertNotDeleted();
    return this.ledger.retract(voter.id);
  }

  addComment(comment: Comment): void {
    this.assertNotDeleted();
    this._comments.push(comment);
  }

  delete(): void {
    this.transitionTo(PostStatus.DELETED);
  }

  protected transitionTo(next: PostStatus): void {
    if (!TRANSITIONS[this._status].includes(next)) {
      throw new InvalidPostTransitionError(this.id, this._status, next);
    }
    this._status = next;
  }

  protected assertNotDeleted(): void {
    if (this._status === PostStatus.DELETED) throw new PostDeletedError(this.id);
  }
}
