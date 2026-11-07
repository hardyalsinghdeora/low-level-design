import type { PostAccessPolicy } from '../access-policy';
import { paginate, type Page, type PageRequest } from '../pagination';
import { newestFirst, type Post } from '../post';
import type { SocialGraph } from '../social-graph';

/** What a feed strategy may read. Passed in, so strategies never reach into the service. */
export interface FeedContext {
  readonly graph: SocialGraph;
  readonly access: PostAccessPolicy;
  postsBy(authorId: string): readonly Post[];
}

/**
 * Strategy: how a home feed is assembled. Implementations must return the
 * same posts for the same data; they differ only in when the work happens.
 */
export interface FeedStrategy {
  readonly name: string;
  onPostCreated(post: Post, ctx: FeedContext): void;
  onFriendshipCreated(a: string, b: string, ctx: FeedContext): void;
  feed(viewerId: string, request: PageRequest, ctx: FeedContext): Page<Post>;
}

/**
 * Fan-out on read: writes do nothing; a read merges the viewer's and their
 * friends' posts. Cheap writes, expensive reads. Right for authors with
 * millions of followers, where pushing to every inbox is too costly.
 */
export class FanOutOnReadFeed implements FeedStrategy {
  readonly name = 'fan-out on read';

  onPostCreated(): void {}

  onFriendshipCreated(): void {}

  feed(viewerId: string, request: PageRequest, ctx: FeedContext): Page<Post> {
    const authors = [viewerId, ...ctx.graph.friendsOf(viewerId)];
    const posts = authors
      .flatMap((authorId) => ctx.postsBy(authorId))
      .filter((post) => ctx.access.belongsInFeed(viewerId, post));
    return paginate(posts.sort(newestFirst), request);
  }
}

/**
 * Fan-out on write: creating a post pushes it into the materialised inbox of
 * every user who may see it at that moment, so a read is a slice of one
 * pre-sorted list. Two details keep it equivalent to fan-out on read:
 * a new friendship backfills both inboxes, and every read re-checks access,
 * because unfriending and blocking happen after the push.
 */
export class FanOutOnWriteFeed implements FeedStrategy {
  readonly name = 'fan-out on write';
  private readonly inboxes = new Map<string, Post[]>();

  onPostCreated(post: Post, ctx: FeedContext): void {
    for (const recipientId of [post.authorId, ...ctx.graph.friendsOf(post.authorId)]) {
      if (ctx.access.belongsInFeed(recipientId, post)) this.push(recipientId, post);
    }
  }

  onFriendshipCreated(a: string, b: string, ctx: FeedContext): void {
    for (const post of ctx.postsBy(b)) if (ctx.access.belongsInFeed(a, post)) this.push(a, post);
    for (const post of ctx.postsBy(a)) if (ctx.access.belongsInFeed(b, post)) this.push(b, post);
  }

  feed(viewerId: string, request: PageRequest, ctx: FeedContext): Page<Post> {
    const inbox = this.inboxes.get(viewerId) ?? [];
    return paginate(
      inbox.filter((post) => ctx.access.belongsInFeed(viewerId, post)),
      request,
    );
  }

  /** How many entries were materialised for a user (visible for tests and capacity planning). */
  inboxSize(userId: string): number {
    return this.inboxes.get(userId)?.length ?? 0;
  }

  /** Sorted insert, idempotent: a backfill never duplicates an entry. */
  private push(userId: string, post: Post): void {
    const inbox = this.inboxes.get(userId) ?? [];
    if (inbox.includes(post)) return;
    const index = inbox.findIndex((existing) => newestFirst(post, existing) < 0);
    inbox.splice(index === -1 ? inbox.length : index, 0, post);
    this.inboxes.set(userId, inbox);
  }
}
