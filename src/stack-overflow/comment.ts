import type { User } from './user';
import { ContentKind, VoteLedger, VoteType, type Votable, type VoteChange } from './vote';

/** Content that carries comments: questions and answers, but not comments themselves. */
export interface Commentable {
  readonly id: string;
  readonly comments: readonly Comment[];
  addComment(comment: Comment): void;
}

/**
 * A short remark on a question or answer. It is Votable but not Commentable,
 * and accepts upvotes only; those votes earn no reputation, as on the real site.
 */
export class Comment implements Votable {
  readonly kind = ContentKind.COMMENT;
  private readonly ledger: VoteLedger;

  constructor(
    readonly id: string,
    readonly author: User,
    readonly parentId: string,
    readonly text: string,
    readonly createdAt: Date,
  ) {
    if (!text.trim()) throw new RangeError('comment text is required');
    this.ledger = new VoteLedger(id, author.id, [VoteType.UP]);
  }

  get score(): number {
    return this.ledger.score;
  }

  voteOf(userId: string): VoteType | null {
    return this.ledger.voteOf(userId);
  }

  castVote(voter: User, vote: VoteType): VoteChange {
    return this.ledger.cast(voter.id, vote);
  }

  retractVote(voter: User): VoteChange {
    return this.ledger.retract(voter.id);
  }
}
