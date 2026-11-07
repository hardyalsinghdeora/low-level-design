import type { Answer } from '../answer';
import type { ForumEvent, ForumListener } from '../events';
import type { Question } from '../question';
import type { User } from '../user';
import { ContentKind, VoteType, type Votable } from '../vote';

export interface ReputationRules {
  upvoteReceived: number;
  downvoteReceived: number;
  downvoteCast: number;
  answerAccepted: number;
}

export const DEFAULT_REPUTATION_RULES: Readonly<ReputationRules> = {
  upvoteReceived: 10,
  downvoteReceived: -2,
  downvoteCast: -1,
  answerAccepted: 15,
};

/**
 * Turns votes and acceptances into reputation. Every change is applied as
 * "undo the old effect, then apply the new one", so switching or retracting a
 * vote, or moving acceptance, can never leave reputation out of step.
 */
export class ReputationListener implements ForumListener {
  constructor(private readonly rules: Readonly<ReputationRules> = DEFAULT_REPUTATION_RULES) {}

  onEvent(event: ForumEvent): void {
    if (event.type === 'VOTE_CHANGED') {
      if (event.target.kind === ContentKind.COMMENT) return; // comment votes earn nothing
      if (event.previous) this.applyVote(event.target, event.voter, event.previous, -1);
      if (event.current) this.applyVote(event.target, event.voter, event.current, 1);
    } else if (event.type === 'ACCEPTANCE_CHANGED') {
      if (event.previous) this.applyAcceptance(event.question, event.previous, -1);
      if (event.current) this.applyAcceptance(event.question, event.current, 1);
    }
  }

  private applyVote(target: Votable, voter: User, vote: VoteType, sign: 1 | -1): void {
    if (vote === VoteType.UP) {
      target.author.adjustReputation(sign * this.rules.upvoteReceived);
      return;
    }
    target.author.adjustReputation(sign * this.rules.downvoteReceived);
    voter.adjustReputation(sign * this.rules.downvoteCast);
  }

  /** Accepting your own answer earns nothing, otherwise self-answers would farm reputation. */
  private applyAcceptance(question: Question, answer: Answer, sign: 1 | -1): void {
    if (answer.author.id === question.author.id) return;
    answer.author.adjustReputation(sign * this.rules.answerAccepted);
  }
}
