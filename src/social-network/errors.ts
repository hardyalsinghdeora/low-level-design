import { DomainError } from '../shared/errors';
import type { FriendRequestStatus } from './friend-request';

export class SocialNetworkError extends DomainError {}

export class UserNotFoundError extends SocialNetworkError {
  constructor(userId: string) {
    super(`No user ${userId}`);
  }
}

export class HandleTakenError extends SocialNetworkError {
  constructor(handle: string) {
    super(`Handle @${handle} is already taken`);
  }
}

/** Also thrown for posts the viewer may not see, so the API never confirms that a hidden post exists. */
export class PostNotFoundError extends SocialNetworkError {
  constructor(postId: string) {
    super(`No post ${postId}`);
  }
}

export class FriendRequestNotFoundError extends SocialNetworkError {
  constructor(requestId: string) {
    super(`No friend request ${requestId}`);
  }
}

export class InvalidFriendRequestTransitionError extends SocialNetworkError {
  constructor(requestId: string, from: FriendRequestStatus, to: FriendRequestStatus) {
    super(`Friend request ${requestId} cannot move from ${from} to ${to}`);
  }
}

export class NotRequestRecipientError extends SocialNetworkError {
  constructor(userId: string, requestId: string) {
    super(`Only the recipient can answer friend request ${requestId}, not ${userId}`);
  }
}

export class DuplicateFriendRequestError extends SocialNetworkError {
  constructor(fromId: string, toId: string) {
    super(`A friend request between ${fromId} and ${toId} is already pending`);
  }
}

export class AlreadyFriendsError extends SocialNetworkError {
  constructor(a: string, b: string) {
    super(`${a} and ${b} are already friends`);
  }
}

export class NotFriendsError extends SocialNetworkError {
  constructor(a: string, b: string) {
    super(`${a} and ${b} are not friends`);
  }
}

export class SelfRelationshipError extends SocialNetworkError {
  constructor(userId: string, action: string) {
    super(`User ${userId} cannot ${action} themselves`);
  }
}

export class UserBlockedError extends SocialNetworkError {
  constructor(a: string, b: string) {
    super(`Interaction between ${a} and ${b} is blocked`);
  }
}

export class AlreadyLikedError extends SocialNetworkError {
  constructor(userId: string, postId: string) {
    super(`User ${userId} already liked ${postId}`);
  }
}

export class NotLikedError extends SocialNetworkError {
  constructor(userId: string, postId: string) {
    super(`User ${userId} has not liked ${postId}`);
  }
}

export class InvalidCursorError extends SocialNetworkError {
  constructor(cursor: string) {
    super(`Cursor "${cursor}" is not valid`);
  }
}
