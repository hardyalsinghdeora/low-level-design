import { Post } from './post';
import type { User } from './user';
import { ContentKind } from './vote';

/** An answer belongs to exactly one question. Acceptance is recorded on the question, not here. */
export class Answer extends Post {
  override readonly kind = ContentKind.ANSWER;

  constructor(
    id: string,
    author: User,
    readonly questionId: string,
    body: string,
    createdAt: Date,
  ) {
    super(id, author, body, createdAt);
  }
}
