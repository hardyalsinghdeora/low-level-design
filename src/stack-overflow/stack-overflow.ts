import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { Answer } from './answer';
import { Comment } from './comment';
import { PermissionDeniedError, PostNotFoundError, UserNotFoundError } from './errors';
import { EventBus, type ForumListener } from './events';
import { ReputationListener } from './listeners/reputation';
import { PostStatus, type Post } from './post';
import { Question, type AcceptanceChange } from './question';
import type { SearchStrategy } from './strategies/search';
import { User } from './user';
import type { Votable, VoteChange, VoteType } from './vote';

export interface StackOverflowOptions {
  clock?: Clock;
  ids?: IdGenerator;
  /** Defaults to the reputation rules alone. Add badges, notifications, indexing, ... here or via `events.subscribe`. */
  listeners?: ForumListener[];
}

/**
 * Application service: finds entities, asks them to change (they enforce the
 * rules), then publishes what happened. It never computes reputation itself,
 * which is why a new reputation or badge rule never touches this file.
 */
export class StackOverflow {
  readonly events = new EventBus();
  private readonly users = new Map<string, User>();
  private readonly questions = new Map<string, Question>();
  private readonly posts = new Map<string, Post>();
  private readonly votables = new Map<string, Votable>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: StackOverflowOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    for (const listener of options.listeners ?? [new ReputationListener()]) this.events.subscribe(listener);
  }

  registerUser(name: string, options: { moderator?: boolean } = {}): User {
    const user = new User(this.ids.next('user'), name, options.moderator ?? false);
    this.users.set(user.id, user);
    return user;
  }

  ask(authorId: string, title: string, body: string, tags: readonly string[]): Question {
    const question = new Question(this.ids.next('q'), this.user(authorId), title, body, tags, this.clock.now());
    this.questions.set(question.id, question);
    this.register(question);
    this.events.publish({ type: 'QUESTION_ASKED', question });
    return question;
  }

  answer(questionId: string, authorId: string, body: string): Answer {
    const question = this.question(questionId);
    const answer = new Answer(this.ids.next('a'), this.user(authorId), question.id, body, this.clock.now());
    question.addAnswer(answer); // throws if the question is closed or deleted
    this.register(answer);
    this.events.publish({ type: 'ANSWER_POSTED', question, answer });
    return answer;
  }

  comment(postId: string, authorId: string, text: string): Comment {
    const post = this.post(postId);
    const comment = new Comment(this.ids.next('c'), this.user(authorId), post.id, text, this.clock.now());
    post.addComment(comment);
    this.votables.set(comment.id, comment);
    return comment;
  }

  vote(targetId: string, voterId: string, vote: VoteType): VoteChange {
    const target = this.votable(targetId);
    const voter = this.user(voterId);
    return this.publishVote(target, voter, target.castVote(voter, vote));
  }

  retractVote(targetId: string, voterId: string): VoteChange {
    const target = this.votable(targetId);
    const voter = this.user(voterId);
    return this.publishVote(target, voter, target.retractVote(voter));
  }

  acceptAnswer(questionId: string, answerId: string, userId: string): AcceptanceChange {
    const question = this.question(questionId);
    const change = question.accept(answerId, this.user(userId));
    if (change.previous !== change.current) this.events.publish({ type: 'ACCEPTANCE_CHANGED', question, ...change });
    return change;
  }

  unacceptAnswer(questionId: string, userId: string): AcceptanceChange {
    const question = this.question(questionId);
    const change = question.unaccept(this.user(userId));
    this.events.publish({ type: 'ACCEPTANCE_CHANGED', question, ...change });
    return change;
  }

  closeQuestion(questionId: string, moderatorId: string): void {
    this.requireModerator(moderatorId, 'close questions');
    this.question(questionId).close();
  }

  reopenQuestion(questionId: string, moderatorId: string): void {
    this.requireModerator(moderatorId, 'reopen questions');
    this.question(questionId).reopen();
  }

  /** Authors may delete their own posts; moderators may delete any post. */
  deletePost(postId: string, userId: string): void {
    const post = this.post(postId);
    const user = this.user(userId);
    if (post.author.id !== user.id && !user.isModerator) throw new PermissionDeniedError(user.id, `delete ${post.id}`);
    post.delete();
  }

  /** Non-deleted questions that match, highest score first, newest first on ties. */
  search(strategy: SearchStrategy): Question[] {
    return [...this.questions.values()]
      .filter((question) => question.status !== PostStatus.DELETED && strategy.matches(question))
      .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
  }

  user(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  }

  question(id: string): Question {
    const question = this.questions.get(id);
    if (!question) throw new PostNotFoundError(id);
    return question;
  }

  private post(id: string): Post {
    const post = this.posts.get(id);
    if (!post) throw new PostNotFoundError(id);
    return post;
  }

  private votable(id: string): Votable {
    const votable = this.votables.get(id);
    if (!votable) throw new PostNotFoundError(id);
    return votable;
  }

  private register(post: Post): void {
    this.posts.set(post.id, post);
    this.votables.set(post.id, post);
  }

  /** A no-op vote (same vote cast again) publishes nothing, so listeners never double count. */
  private publishVote(target: Votable, voter: User, change: VoteChange): VoteChange {
    if (change.previous !== change.current) this.events.publish({ type: 'VOTE_CHANGED', target, voter, ...change });
    return change;
  }

  private requireModerator(userId: string, action: string): void {
    if (!this.user(userId).isModerator) throw new PermissionDeniedError(userId, action);
  }
}
