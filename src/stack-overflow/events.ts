import type { Answer } from './answer';
import type { Question } from './question';
import type { User } from './user';
import type { Votable, VoteType } from './vote';

/** Facts the service publishes after a change succeeded. Listeners decide what they mean. */
export type ForumEvent =
  | { type: 'QUESTION_ASKED'; question: Question }
  | { type: 'ANSWER_POSTED'; question: Question; answer: Answer }
  | { type: 'VOTE_CHANGED'; target: Votable; voter: User; previous: VoteType | null; current: VoteType | null }
  | { type: 'ACCEPTANCE_CHANGED'; question: Question; previous: Answer | null; current: Answer | null };

/** Observer: reputation, badges, notifications and search indexing all plug in here. */
export interface ForumListener {
  onEvent(event: ForumEvent): void;
}

/**
 * Synchronous in-process bus. In production the service writes events to an
 * outbox table in the same transaction as the vote, and a queue delivers them.
 */
export class EventBus {
  private readonly listeners = new Set<ForumListener>();

  /** Returns an unsubscribe function. */
  subscribe(listener: ForumListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ForumEvent): void {
    for (const listener of this.listeners) listener.onEvent(event);
  }
}
