import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { PostAccessPolicy } from './access-policy';
import {
  AlreadyFriendsError,
  DuplicateFriendRequestError,
  FriendRequestNotFoundError,
  HandleTakenError,
  NotFriendsError,
  NotRequestRecipientError,
  PostNotFoundError,
  SelfRelationshipError,
  UserBlockedError,
  UserNotFoundError,
} from './errors';
import { FriendRequest } from './friend-request';
import { NotificationCenter, NotificationType } from './notifications';
import { paginate, type Page, type PageRequest } from './pagination';
import { newestFirst, Post, Visibility, type PostComment } from './post';
import { SocialGraph } from './social-graph';
import { FanOutOnWriteFeed, type FeedContext, type FeedStrategy } from './strategies/feed';
import { User, type Profile } from './user';

export interface SocialNetworkOptions {
  feedStrategy?: FeedStrategy;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Application service. It orchestrates users, requests, posts and the graph,
 * but delegates every "may X see Y" decision to PostAccessPolicy and every
 * feed decision to the FeedStrategy, so neither rule is duplicated here.
 */
export class SocialNetwork {
  readonly notifications = new NotificationCenter();
  private readonly users = new Map<string, User>();
  private readonly handles = new Set<string>();
  private readonly requests = new Map<string, FriendRequest>();
  private readonly posts = new Map<string, Post>();
  private readonly postsByAuthor = new Map<string, Post[]>();
  private readonly graph = new SocialGraph();
  private readonly access = new PostAccessPolicy(this.graph);
  private readonly context: FeedContext;
  private readonly feedStrategy: FeedStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private sequence = 0;

  constructor(options: SocialNetworkOptions = {}) {
    this.feedStrategy = options.feedStrategy ?? new FanOutOnWriteFeed();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.context = { graph: this.graph, access: this.access, postsBy: (id) => this.postsByAuthor.get(id) ?? [] };
  }

  register(handle: string, profile: Partial<Profile> = {}): User {
    if (this.handles.has(handle)) throw new HandleTakenError(handle);
    const user = new User(this.ids.next('user'), handle, profile);
    this.users.set(user.id, user);
    this.handles.add(handle);
    return user;
  }

  updateProfile(userId: string, changes: Partial<Profile>): User {
    const user = this.user(userId);
    user.updateProfile(changes);
    return user;
  }

  sendFriendRequest(fromId: string, toId: string): FriendRequest {
    this.assertCanInteract(fromId, toId, 'send a friend request to');
    if (this.graph.areFriends(fromId, toId)) throw new AlreadyFriendsError(fromId, toId);
    if (this.pendingBetween(fromId, toId)) throw new DuplicateFriendRequestError(fromId, toId);
    const request = new FriendRequest(this.ids.next('req'), fromId, toId, this.clock.now());
    this.requests.set(request.id, request);
    this.notify(NotificationType.FRIEND_REQUEST_RECEIVED, toId, fromId, request.id);
    return request;
  }

  /** Accepting is the only way a friendship is created, and it is created in both directions at once. */
  acceptFriendRequest(requestId: string, userId: string): void {
    const request = this.recipientRequest(requestId, userId);
    request.accept(this.clock.now()); // throws unless PENDING
    this.graph.addFriendship(request.fromId, request.toId);
    this.feedStrategy.onFriendshipCreated(request.fromId, request.toId, this.context);
    this.notify(NotificationType.FRIEND_REQUEST_ACCEPTED, request.fromId, request.toId, request.id);
  }

  rejectFriendRequest(requestId: string, userId: string): void {
    this.recipientRequest(requestId, userId).reject(this.clock.now());
  }

  unfriend(userId: string, friendId: string): void {
    if (!this.graph.removeFriendship(userId, friendId)) throw new NotFriendsError(userId, friendId);
  }

  /** Ends any friendship and rejects pending requests; from now on neither side sees the other. */
  block(blockerId: string, blockedId: string): void {
    this.user(blockerId);
    this.user(blockedId);
    if (blockerId === blockedId) throw new SelfRelationshipError(blockerId, 'block');
    this.graph.block(blockerId, blockedId);
    this.pendingBetween(blockerId, blockedId)?.reject(this.clock.now());
  }

  unblock(blockerId: string, blockedId: string): void {
    this.graph.unblock(blockerId, blockedId);
  }

  areFriends(a: string, b: string): boolean {
    return this.graph.areFriends(a, b);
  }

  createPost(authorId: string, text: string, visibility = Visibility.FRIENDS): Post {
    this.user(authorId);
    this.sequence += 1;
    const post = new Post(this.ids.next('post'), authorId, text, visibility, this.clock.now(), this.sequence);
    const authored = this.postsByAuthor.get(authorId) ?? [];
    authored.push(post);
    this.posts.set(post.id, post);
    this.postsByAuthor.set(authorId, authored);
    this.feedStrategy.onPostCreated(post, this.context);
    return post;
  }

  like(postId: string, userId: string): void {
    const post = this.visiblePost(postId, userId);
    post.like(userId);
    if (post.authorId !== userId) this.notify(NotificationType.POST_LIKED, post.authorId, userId, post.id);
  }

  unlike(postId: string, userId: string): void {
    this.visiblePost(postId, userId).unlike(userId);
  }

  comment(postId: string, userId: string, text: string): PostComment {
    const post = this.visiblePost(postId, userId);
    const comment: PostComment = { id: this.ids.next('cmt'), authorId: userId, text, createdAt: this.clock.now() };
    post.addComment(comment);
    if (post.authorId !== userId) this.notify(NotificationType.POST_COMMENTED, post.authorId, userId, post.id);
    return comment;
  }

  canView(viewerId: string, postId: string): boolean {
    const post = this.posts.get(postId);
    return post !== undefined && this.access.canView(viewerId, post);
  }

  /** A profile page: the author's posts this viewer may see, newest first. */
  timeline(authorId: string, viewerId: string, request: PageRequest = {}): Page<Post> {
    const posts = (this.postsByAuthor.get(this.user(authorId).id) ?? []).filter((p) => this.access.canView(viewerId, p));
    return paginate(posts.sort(newestFirst), request);
  }

  feed(viewerId: string, request: PageRequest = {}): Page<Post> {
    return this.feedStrategy.feed(this.user(viewerId).id, request, this.context);
  }

  user(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  }

  private visiblePost(postId: string, viewerId: string): Post {
    this.user(viewerId);
    const post = this.posts.get(postId);
    if (!post || !this.access.canView(viewerId, post)) throw new PostNotFoundError(postId);
    return post;
  }

  private recipientRequest(requestId: string, userId: string): FriendRequest {
    const request = this.requests.get(requestId);
    if (!request) throw new FriendRequestNotFoundError(requestId);
    if (request.toId !== userId) throw new NotRequestRecipientError(userId, requestId);
    return request;
  }

  private pendingBetween(a: string, b: string): FriendRequest | undefined {
    return [...this.requests.values()].find((request) => request.isPendingBetween(a, b));
  }

  private assertCanInteract(fromId: string, toId: string, action: string): void {
    this.user(fromId);
    this.user(toId);
    if (fromId === toId) throw new SelfRelationshipError(fromId, action);
    if (this.graph.isBlockedBetween(fromId, toId)) throw new UserBlockedError(fromId, toId);
  }

  private notify(type: NotificationType, recipientId: string, actorId: string, subjectId: string): void {
    const id = this.ids.next('ntf');
    this.notifications.publish({ id, type, recipientId, actorId, subjectId, createdAt: this.clock.now() });
  }
}
