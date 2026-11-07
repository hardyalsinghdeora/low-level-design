import type { Post } from './post';
import { Visibility } from './post';
import type { SocialGraph } from './social-graph';

type VisibilityRule = (viewerId: string, authorId: string, graph: SocialGraph) => boolean;

const RULES: Record<Visibility, VisibilityRule> = {
  [Visibility.PUBLIC]: () => true,
  [Visibility.FRIENDS]: (viewerId, authorId, graph) => graph.areFriends(viewerId, authorId),
  [Visibility.PRIVATE]: () => false,
};

/**
 * The single answer to "may this viewer see this post?". Feeds, profile
 * timelines, likes and comments all ask here, so the rules cannot drift apart
 * between features. Blocking overrides every visibility level.
 */
export class PostAccessPolicy {
  constructor(private readonly graph: SocialGraph) {}

  canView(viewerId: string, post: Post): boolean {
    if (viewerId === post.authorId) return true;
    if (this.graph.isBlockedBetween(viewerId, post.authorId)) return false;
    return RULES[post.visibility](viewerId, post.authorId, this.graph);
  }

  /** A home feed shows your own posts and your friends' posts, each only if you may see it. */
  belongsInFeed(viewerId: string, post: Post): boolean {
    const fromNetwork = post.authorId === viewerId || this.graph.areFriends(viewerId, post.authorId);
    return fromNetwork && this.canView(viewerId, post);
  }
}
