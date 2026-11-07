import { NoVoteToRetractError, SelfVoteError, VoteNotAllowedError } from './errors';
import type { User } from './user';

export enum VoteType {
  UP = 'UP',
  DOWN = 'DOWN',
}

export enum ContentKind {
  QUESTION = 'QUESTION',
  ANSWER = 'ANSWER',
  COMMENT = 'COMMENT',
}

/** What a vote call changed. `previous === current` means nothing changed (a retried request). */
export interface VoteChange {
  previous: VoteType | null;
  current: VoteType | null;
}

/** Anything users vote on. Questions, answers and comments all implement it. */
export interface Votable {
  readonly id: string;
  readonly kind: ContentKind;
  readonly author: User;
  readonly score: number;
  voteOf(userId: string): VoteType | null;
  castVote(voter: User, vote: VoteType): VoteChange;
  retractVote(voter: User): VoteChange;
}

/**
 * One vote per user per post. The ledger owns the votes and derives the score
 * from them, so the score can never drift from the votes that produced it.
 * Questions, answers and comments compose one instead of inheriting it.
 */
export class VoteLedger {
  private readonly votes = new Map<string, VoteType>();

  constructor(
    private readonly contentId: string,
    private readonly authorId: string,
    private readonly allowedVotes: readonly VoteType[] = [VoteType.UP, VoteType.DOWN],
  ) {}

  get score(): number {
    let score = 0;
    for (const vote of this.votes.values()) score += vote === VoteType.UP ? 1 : -1;
    return score;
  }

  voteOf(userId: string): VoteType | null {
    return this.votes.get(userId) ?? null;
  }

  /** Casting the vote you already have is a no-op, so a retried request cannot count twice. */
  cast(voterId: string, vote: VoteType): VoteChange {
    if (voterId === this.authorId) throw new SelfVoteError(voterId, this.contentId);
    if (!this.allowedVotes.includes(vote)) throw new VoteNotAllowedError(this.contentId, vote);
    const previous = this.voteOf(voterId);
    this.votes.set(voterId, vote);
    return { previous, current: vote };
  }

  retract(voterId: string): VoteChange {
    const previous = this.voteOf(voterId);
    if (previous === null) throw new NoVoteToRetractError(voterId, this.contentId);
    this.votes.delete(voterId);
    return { previous, current: null };
  }
}
