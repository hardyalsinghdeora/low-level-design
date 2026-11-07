import type { ForumEvent, ForumListener } from '../events';
import { ContentKind } from '../vote';

export enum Badge {
  STUDENT = 'Student', // a question reached a score of 1
  TEACHER = 'Teacher', // an answer reached a score of 1
  SCHOLAR = 'Scholar', // accepted an answer to their own question
}

/**
 * The proof that the event bus is the extension point: badges are one new
 * listener, and no entity or service code changed to add them.
 */
export class BadgeListener implements ForumListener {
  onEvent(event: ForumEvent): void {
    if (event.type === 'VOTE_CHANGED' && event.target.score >= 1) {
      if (event.target.kind === ContentKind.QUESTION) event.target.author.awardBadge(Badge.STUDENT);
      if (event.target.kind === ContentKind.ANSWER) event.target.author.awardBadge(Badge.TEACHER);
    }
    if (event.type === 'ACCEPTANCE_CHANGED' && event.current) {
      event.question.author.awardBadge(Badge.SCHOLAR);
    }
  }
}
