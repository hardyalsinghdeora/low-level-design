import { DomainError } from '../shared/errors';
import type { PostStatus } from './post';
import type { VoteType } from './vote';

export class StackOverflowError extends DomainError {}

export class UserNotFoundError extends StackOverflowError {
  constructor(userId: string) {
    super(`No user ${userId}`);
  }
}

export class PostNotFoundError extends StackOverflowError {
  constructor(postId: string) {
    super(`No post ${postId}`);
  }
}

export class SelfVoteError extends StackOverflowError {
  constructor(userId: string, postId: string) {
    super(`User ${userId} cannot vote on their own post ${postId}`);
  }
}

export class NoVoteToRetractError extends StackOverflowError {
  constructor(userId: string, postId: string) {
    super(`User ${userId} has no vote on ${postId} to retract`);
  }
}

export class VoteNotAllowedError extends StackOverflowError {
  constructor(postId: string, vote: VoteType) {
    super(`${vote} votes are not allowed on ${postId}`);
  }
}

export class PostDeletedError extends StackOverflowError {
  constructor(postId: string) {
    super(`Post ${postId} is deleted`);
  }
}

export class QuestionClosedError extends StackOverflowError {
  constructor(questionId: string) {
    super(`Question ${questionId} is closed and does not accept answers`);
  }
}

export class InvalidPostTransitionError extends StackOverflowError {
  constructor(postId: string, from: PostStatus, to: PostStatus) {
    super(`Post ${postId} cannot move from ${from} to ${to}`);
  }
}

export class NotQuestionAuthorError extends StackOverflowError {
  constructor(userId: string, questionId: string) {
    super(`Only the author of ${questionId} can change its accepted answer, not ${userId}`);
  }
}

export class AnswerNotOnQuestionError extends StackOverflowError {
  constructor(answerId: string, questionId: string) {
    super(`Answer ${answerId} does not belong to question ${questionId}`);
  }
}

export class NoAcceptedAnswerError extends StackOverflowError {
  constructor(questionId: string) {
    super(`Question ${questionId} has no accepted answer`);
  }
}

export class PermissionDeniedError extends StackOverflowError {
  constructor(userId: string, action: string) {
    super(`User ${userId} is not allowed to ${action}`);
  }
}
