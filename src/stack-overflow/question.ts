import type { Answer } from './answer';
import {
  AnswerNotOnQuestionError,
  NoAcceptedAnswerError,
  NotQuestionAuthorError,
  PostDeletedError,
  QuestionClosedError,
} from './errors';
import { Post, PostStatus } from './post';
import type { User } from './user';
import { ContentKind } from './vote';

/** Lower-case and hyphenated, so "Node JS" and "node-js" are the same tag. */
export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Which answer was accepted before and after a change; `null` means none. */
export interface AcceptanceChange {
  previous: Answer | null;
  current: Answer | null;
}

/**
 * The aggregate for one thread. It owns its answers and the single accepted
 * answer, so "at most one accepted answer, chosen by the asker" is enforced
 * here and nowhere else.
 */
export class Question extends Post {
  override readonly kind = ContentKind.QUESTION;
  readonly tags: ReadonlySet<string>;
  private readonly _answers: Answer[] = [];
  private acceptedId: string | null = null;

  constructor(
    id: string,
    author: User,
    readonly title: string,
    body: string,
    tags: readonly string[],
    createdAt: Date,
  ) {
    super(id, author, body, createdAt);
    if (!title.trim()) throw new RangeError('title is required');
    const normalised = new Set(tags.map(normaliseTag).filter(Boolean));
    if (normalised.size < 1 || normalised.size > 5) throw new RangeError('a question needs 1 to 5 tags');
    this.tags = normalised;
  }

  get answers(): readonly Answer[] {
    return this._answers;
  }

  get acceptedAnswer(): Answer | null {
    return this._answers.find((answer) => answer.id === this.acceptedId) ?? null;
  }

  addAnswer(answer: Answer): void {
    this.assertNotDeleted();
    if (this.status === PostStatus.CLOSED) throw new QuestionClosedError(this.id);
    if (answer.questionId !== this.id) throw new AnswerNotOnQuestionError(answer.id, this.id);
    this._answers.push(answer);
  }

  /** Accepting another answer replaces the current one; the change is returned so reputation can follow it. */
  accept(answerId: string, by: User): AcceptanceChange {
    this.assertAuthor(by);
    const answer = this._answers.find((candidate) => candidate.id === answerId);
    if (!answer) throw new AnswerNotOnQuestionError(answerId, this.id);
    if (answer.status === PostStatus.DELETED) throw new PostDeletedError(answer.id);
    const previous = this.acceptedAnswer;
    this.acceptedId = answer.id;
    return { previous, current: answer };
  }

  unaccept(by: User): AcceptanceChange {
    this.assertAuthor(by);
    const previous = this.acceptedAnswer;
    if (!previous) throw new NoAcceptedAnswerError(this.id);
    this.acceptedId = null;
    return { previous, current: null };
  }

  close(): void {
    this.transitionTo(PostStatus.CLOSED);
  }

  reopen(): void {
    this.transitionTo(PostStatus.OPEN);
  }

  private assertAuthor(user: User): void {
    this.assertNotDeleted();
    if (user.id !== this.author.id) throw new NotQuestionAuthorError(user.id, this.id);
  }
}
