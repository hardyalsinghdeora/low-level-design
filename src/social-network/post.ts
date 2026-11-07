import { AlreadyLikedError, NotLikedError } from './errors';

export enum Visibility {
  PUBLIC = 'PUBLIC',
  FRIENDS = 'FRIENDS',
  PRIVATE = 'PRIVATE',
}

export interface PostComment {
  id: string;
  authorId: string;
  text: string;
  createdAt: Date;
}

/**
 * A post and its reactions. Likes are a set keyed by user, which makes "one
 * like per user" structural rather than a check someone can forget.
 */
export class Post {
  private readonly likes = new Set<string>();
  private readonly _comments: PostComment[] = [];

  constructor(
    readonly id: string,
    readonly authorId: string,
    readonly text: string,
    readonly visibility: Visibility,
    readonly createdAt: Date,
    /**
     * Monotonic insertion order. Stands in for a time-ordered (Snowflake) id so
     * feeds and cursors have a total order even when two posts share a timestamp.
     */
    readonly sequence: number,
  ) {
    if (!text.trim()) throw new RangeError('post text is required');
  }

  get likeCount(): number {
    return this.likes.size;
  }

  get comments(): readonly PostComment[] {
    return this._comments;
  }

  isLikedBy(userId: string): boolean {
    return this.likes.has(userId);
  }

  like(userId: string): void {
    if (this.likes.has(userId)) throw new AlreadyLikedError(userId, this.id);
    this.likes.add(userId);
  }

  unlike(userId: string): void {
    if (!this.likes.delete(userId)) throw new NotLikedError(userId, this.id);
  }

  addComment(comment: PostComment): void {
    if (!comment.text.trim()) throw new RangeError('comment text is required');
    this._comments.push(comment);
  }
}

/** Newest first; ties on time are broken by sequence so the order is total. */
export function newestFirst(a: Post, b: Post): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || b.sequence - a.sequence;
}
