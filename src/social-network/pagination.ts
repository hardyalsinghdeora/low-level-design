import { InvalidCursorError } from './errors';
import type { Post } from './post';

export interface PageRequest {
  limit?: number;
  /** Opaque value from a previous page's `nextCursor`. */
  cursor?: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface CursorKey {
  createdAtMs: number;
  sequence: number;
}

/** The cursor is the sort key of the last item served, base64url encoded so clients treat it as opaque. */
export function encodeCursor(post: Post): string {
  return Buffer.from(`${post.createdAt.getTime()}:${post.sequence}`).toString('base64url');
}

export function decodeCursor(cursor: string): CursorKey {
  const match = /^(\d+):(\d+)$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!match) throw new InvalidCursorError(cursor);
  return { createdAtMs: Number(match[1]), sequence: Number(match[2]) };
}

function isAfter(post: Post, key: CursorKey): boolean {
  const time = post.createdAt.getTime();
  return time < key.createdAtMs || (time === key.createdAtMs && post.sequence < key.sequence);
}

/**
 * Keyset pagination over a newest-first list. Unlike offsets, a post created
 * between two page requests does not shift the next page (no duplicates, no gaps).
 */
export function paginate(sortedNewestFirst: readonly Post[], request: PageRequest = {}): Page<Post> {
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError(`limit must be 1-100, got ${limit}`);
  const key = request.cursor ? decodeCursor(request.cursor) : null;
  const remaining = key ? sortedNewestFirst.filter((post) => isAfter(post, key)) : sortedNewestFirst;
  const items = remaining.slice(0, limit);
  const hasMore = remaining.length > limit;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}
