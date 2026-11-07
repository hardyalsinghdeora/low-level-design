import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AlreadyFriendsError,
  AlreadyLikedError,
  DuplicateFriendRequestError,
  FanOutOnReadFeed,
  FanOutOnWriteFeed,
  type FeedStrategy,
  FriendRequestStatus,
  HandleTakenError,
  InvalidCursorError,
  InvalidFriendRequestTransitionError,
  NotFriendsError,
  NotificationInbox,
  NotificationType,
  NotLikedError,
  NotRequestRecipientError,
  PostNotFoundError,
  SelfRelationshipError,
  SocialNetwork,
  type User,
  UserBlockedError,
  UserNotFoundError,
  Visibility,
} from './index';

function build(feedStrategy: FeedStrategy = new FanOutOnWriteFeed()) {
  const clock = new FakeClock('2026-06-01T08:00:00Z');
  const network = new SocialNetwork({ feedStrategy, clock, ids: new SequentialIdGenerator() });
  const inbox = new NotificationInbox();
  network.notifications.subscribe(inbox);
  const ana = network.register('ana');
  const ben = network.register('ben');
  const cai = network.register('cai');
  return { network, clock, inbox, ana, ben, cai };
}

function befriend(network: SocialNetwork, a: User, b: User): void {
  const request = network.sendFriendRequest(a.id, b.id);
  network.acceptFriendRequest(request.id, b.id);
}

describe('friendships', () => {
  it('accepting a request creates a symmetric friendship and notifies both sides', () => {
    const { network, inbox, ana, ben } = build();
    const request = network.sendFriendRequest(ana.id, ben.id);
    expect(inbox.for(ben.id).map((n) => n.type)).toEqual([NotificationType.FRIEND_REQUEST_RECEIVED]);

    network.acceptFriendRequest(request.id, ben.id);
    expect(request.status).toBe(FriendRequestStatus.ACCEPTED);
    expect([network.areFriends(ana.id, ben.id), network.areFriends(ben.id, ana.id)]).toEqual([true, true]);
    expect(inbox.for(ana.id)[0]).toMatchObject({
      type: NotificationType.FRIEND_REQUEST_ACCEPTED,
      actorId: ben.id,
      subjectId: request.id,
    });
  });

  it('validates transitions, who may answer, and duplicate requests', () => {
    const { network, ana, ben, cai } = build();
    const request = network.sendFriendRequest(ana.id, ben.id);
    expect(() => network.sendFriendRequest(ben.id, ana.id)).toThrow(DuplicateFriendRequestError);
    expect(() => network.acceptFriendRequest(request.id, cai.id)).toThrow(NotRequestRecipientError);

    network.rejectFriendRequest(request.id, ben.id);
    expect(() => network.acceptFriendRequest(request.id, ben.id)).toThrow(InvalidFriendRequestTransitionError);
    expect(network.areFriends(ana.id, ben.id)).toBe(false);

    expect(() => network.sendFriendRequest(ana.id, ana.id)).toThrow(SelfRelationshipError);
    befriend(network, ana, cai);
    expect(() => network.sendFriendRequest(cai.id, ana.id)).toThrow(AlreadyFriendsError);
  });

  it('unfriending removes the friendship from both sides', () => {
    const { network, ana, ben } = build();
    befriend(network, ana, ben);
    network.unfriend(ben.id, ana.id);
    expect([network.areFriends(ana.id, ben.id), network.areFriends(ben.id, ana.id)]).toEqual([false, false]);
    expect(() => network.unfriend(ana.id, ben.id)).toThrow(NotFriendsError);
  });
});

describe('posts, visibility and blocking', () => {
  it('applies PUBLIC, FRIENDS and PRIVATE visibility', () => {
    const { network, ana, ben, cai } = build();
    befriend(network, ana, ben);
    const pub = network.createPost(ana.id, 'hello world', Visibility.PUBLIC);
    const friendsOnly = network.createPost(ana.id, 'party at mine', Visibility.FRIENDS);
    const priv = network.createPost(ana.id, 'diary', Visibility.PRIVATE);
    const sees = (viewer: User) => [pub, friendsOnly, priv].map((post) => network.canView(viewer.id, post.id));

    expect(sees(ana)).toEqual([true, true, true]);
    expect(sees(ben)).toEqual([true, true, false]);
    expect(sees(cai)).toEqual([true, false, false]);
    expect(network.timeline(ana.id, cai.id).items).toEqual([pub]);
  });

  it('blocking hides posts both ways, ends the friendship and stops requests and likes', () => {
    const { network, ana, ben, cai } = build();
    befriend(network, ana, ben);
    const anaPost = network.createPost(ana.id, 'public news', Visibility.PUBLIC);
    const benPost = network.createPost(ben.id, 'my public post', Visibility.PUBLIC);
    const pending = network.sendFriendRequest(cai.id, ana.id);

    network.block(ana.id, ben.id);
    network.block(ana.id, cai.id);
    expect(network.areFriends(ana.id, ben.id)).toBe(false);
    expect([network.canView(ben.id, anaPost.id), network.canView(ana.id, benPost.id)]).toEqual([false, false]);
    expect(() => network.like(anaPost.id, ben.id)).toThrow(PostNotFoundError);
    expect(() => network.sendFriendRequest(ben.id, ana.id)).toThrow(UserBlockedError);
    expect(pending.status).toBe(FriendRequestStatus.REJECTED);

    network.unblock(ana.id, cai.id);
    expect(network.canView(cai.id, anaPost.id)).toBe(true);
  });

  it('allows one like per user and notifies the author, never the liker themselves', () => {
    const { network, inbox, ana, ben, cai } = build();
    const post = network.createPost(ana.id, 'look at this', Visibility.PUBLIC);
    network.like(post.id, ben.id);
    expect(() => network.like(post.id, ben.id)).toThrow(AlreadyLikedError);
    network.like(post.id, ana.id); // counted, but nobody is notified of their own like
    network.comment(post.id, cai.id, 'nice');

    expect(post.likeCount).toBe(2);
    expect(inbox.for(ana.id).map((n) => [n.type, n.actorId])).toEqual([
      [NotificationType.POST_COMMENTED, cai.id],
      [NotificationType.POST_LIKED, ben.id],
    ]);
    network.unlike(post.id, ben.id);
    expect(() => network.unlike(post.id, ben.id)).toThrow(NotLikedError);
  });
});

describe.each([
  ['fan-out on read', () => new FanOutOnReadFeed()],
  ['fan-out on write', () => new FanOutOnWriteFeed()],
])('%s feed', (_name, makeStrategy) => {
  it('shows own and friends posts the viewer may see, newest first', () => {
    const { network, clock, ana, ben, cai } = build(makeStrategy());
    befriend(network, ana, ben);
    const fromBen = network.createPost(ben.id, 'ben to friends', Visibility.FRIENDS);
    clock.advanceMinutes(1);
    network.createPost(cai.id, 'stranger, public', Visibility.PUBLIC);
    network.createPost(ben.id, 'ben private', Visibility.PRIVATE);
    clock.advanceMinutes(1);
    const own = network.createPost(ana.id, 'ana private', Visibility.PRIVATE);

    expect(network.feed(ana.id).items).toEqual([own, fromBen]);
  });
});

describe('feed strategies', () => {
  function scenario(strategy: FeedStrategy): Record<string, string[]> {
    const { network, clock, ana, ben, cai } = build(strategy);
    const dan = network.register('dan');
    const post = (author: User, text: string, visibility: Visibility) => {
      network.createPost(author.id, text, visibility);
      clock.advanceMinutes(1);
    };
    befriend(network, ana, ben);
    post(ben, 'b1', Visibility.FRIENDS);
    post(cai, 'c1', Visibility.PUBLIC);
    post(dan, 'd1', Visibility.FRIENDS);
    befriend(network, ana, cai); // after c1 was posted: fan-out on write must backfill
    post(ana, 'a1', Visibility.FRIENDS);
    befriend(network, ben, dan);
    post(dan, 'd2', Visibility.PUBLIC);
    network.block(dan.id, ana.id);
    network.unfriend(ana.id, ben.id); // already-pushed entries must disappear on read
    post(ben, 'b2', Visibility.PRIVATE);
    const users = [ana, ben, cai, dan];
    return Object.fromEntries(users.map((u) => [u.handle, network.feed(u.id).items.map((p) => p.text)]));
  }

  it('fan-out on write and fan-out on read produce the same feeds for the same history', () => {
    const onRead = scenario(new FanOutOnReadFeed());
    expect(scenario(new FanOutOnWriteFeed())).toEqual(onRead);
    expect(onRead).toEqual({ ana: ['a1', 'c1'], ben: ['b2', 'd2', 'd1', 'b1'], cai: ['a1', 'c1'], dan: ['d2', 'd1', 'b1'] });
  });

  it('fan-out on write materialises inboxes when the post is created', () => {
    const strategy = new FanOutOnWriteFeed();
    const { network, ana, ben, cai } = build(strategy);
    befriend(network, ana, ben);
    befriend(network, ana, cai);
    network.createPost(ana.id, 'to friends', Visibility.FRIENDS);
    expect([ana, ben, cai].map((u) => strategy.inboxSize(u.id))).toEqual([1, 1, 1]);
    network.createPost(ana.id, 'just me', Visibility.PRIVATE);
    expect([ana, ben, cai].map((u) => strategy.inboxSize(u.id))).toEqual([2, 1, 1]);
  });

  it('pages with opaque cursors, unaffected by posts created between pages', () => {
    const { network, clock, ana } = build(new FanOutOnReadFeed());
    const posts = [1, 2, 3, 4, 5].map((n) => {
      clock.advanceMinutes(1);
      return network.createPost(ana.id, `post ${n}`, Visibility.PUBLIC);
    });
    const first = network.feed(ana.id, { limit: 2 });
    network.createPost(ana.id, 'arrives mid-scroll', Visibility.PUBLIC);
    const second = network.feed(ana.id, { limit: 2, cursor: first.nextCursor });
    const third = network.feed(ana.id, { limit: 2, cursor: second.nextCursor });

    expect([...first.items, ...second.items].map((p) => p.text)).toEqual(['post 5', 'post 4', 'post 3', 'post 2']);
    expect(third).toEqual({ items: [posts[0]], nextCursor: null });
    expect(() => network.feed(ana.id, { cursor: 'not-a-cursor' })).toThrow(InvalidCursorError);
  });
});

describe('users', () => {
  it('validates profiles, unique handles and unknown users', () => {
    const { network, ana } = build();
    network.updateProfile(ana.id, { displayName: 'Ana Silva', city: 'Lisbon' });
    expect(ana.profile).toEqual({ displayName: 'Ana Silva', bio: '', city: 'Lisbon' });
    expect(() => network.updateProfile(ana.id, { displayName: ' ' })).toThrow(RangeError);
    expect(() => network.register('ana')).toThrow(HandleTakenError);
    expect(() => network.sendFriendRequest(ana.id, 'ghost')).toThrow(UserNotFoundError);
  });
});
