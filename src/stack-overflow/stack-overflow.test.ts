import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AllOf,
  AnswerNotOnQuestionError,
  AnyOf,
  AuthorSearch,
  Badge,
  BadgeListener,
  InvalidPostTransitionError,
  KeywordSearch,
  NoVoteToRetractError,
  NotQuestionAuthorError,
  PermissionDeniedError,
  PostDeletedError,
  PostNotFoundError,
  PostStatus,
  QuestionClosedError,
  ReputationListener,
  SelfVoteError,
  StackOverflow,
  TagSearch,
  User,
  UserNotFoundError,
  VoteNotAllowedError,
  VoteType,
} from './index';

const START = 1; // every new user starts with 1 reputation, as on the real site

describe('StackOverflow', () => {
  let site: StackOverflow;
  let clock: FakeClock;
  let asker: User;
  let alice: User;
  let bob: User;
  let voter: User;
  let mod: User;

  beforeEach(() => {
    clock = new FakeClock('2026-05-01T10:00:00Z');
    site = new StackOverflow({ clock, ids: new SequentialIdGenerator() });
    asker = site.registerUser('asker');
    alice = site.registerUser('alice');
    bob = site.registerUser('bob');
    voter = site.registerUser('voter');
    mod = site.registerUser('mod', { moderator: true });
  });

  function askAndAnswer() {
    const question = site.ask(asker.id, 'How to debounce in TypeScript?', 'Typed debounce helper?', ['TypeScript', 'Node JS']);
    const fromAlice = site.answer(question.id, alice.id, 'Use a closure over a timer handle.');
    const fromBob = site.answer(question.id, bob.id, 'Use lodash.debounce.');
    return { question, fromAlice, fromBob };
  }

  it('asks a question with normalised tags and collects answers', () => {
    const { question, fromAlice } = askAndAnswer();
    expect(question.id).toBe('q-6');
    expect([...question.tags]).toEqual(['typescript', 'node-js']);
    expect(question.answers.map((a) => a.author.name)).toEqual(['alice', 'bob']);
    expect(fromAlice.questionId).toBe(question.id);
    expect(question.status).toBe(PostStatus.OPEN);
  });

  it('allows one vote per user: repeating a vote changes nothing', () => {
    const { fromAlice } = askAndAnswer();
    site.vote(fromAlice.id, voter.id, VoteType.UP);
    const repeat = site.vote(fromAlice.id, voter.id, VoteType.UP);

    expect(repeat).toEqual({ previous: VoteType.UP, current: VoteType.UP });
    expect(fromAlice.score).toBe(1);
    expect(alice.reputation).toBe(START + 10);
  });

  it('switching and retracting a vote keeps reputation exact', () => {
    const { fromAlice } = askAndAnswer();

    site.vote(fromAlice.id, voter.id, VoteType.DOWN);
    expect([alice.reputation, voter.reputation]).toEqual([START - 2, START - 1]);

    site.vote(fromAlice.id, voter.id, VoteType.UP); // undo -2/-1, apply +10
    expect([alice.reputation, voter.reputation]).toEqual([START + 10, START]);
    expect(fromAlice.score).toBe(1);

    site.vote(fromAlice.id, voter.id, VoteType.DOWN); // undo +10, apply -2/-1
    expect([alice.reputation, voter.reputation]).toEqual([START - 2, START - 1]);

    site.retractVote(fromAlice.id, voter.id);
    expect([alice.reputation, voter.reputation]).toEqual([START, START]);
    expect(fromAlice.score).toBe(0);
  });

  it('rejects voting on your own post and retracting a vote you never cast', () => {
    const { fromAlice } = askAndAnswer();
    expect(() => site.vote(fromAlice.id, alice.id, VoteType.UP)).toThrow(SelfVoteError);
    expect(() => site.retractVote(fromAlice.id, voter.id)).toThrow(NoVoteToRetractError);
  });

  it('lets comments be upvoted for free but never downvoted', () => {
    const { fromAlice } = askAndAnswer();
    const comment = site.comment(fromAlice.id, bob.id, 'Remember to clear the timer.');

    site.vote(comment.id, voter.id, VoteType.UP);
    expect(comment.score).toBe(1);
    expect(bob.reputation).toBe(START);
    expect(() => site.vote(comment.id, voter.id, VoteType.DOWN)).toThrow(VoteNotAllowedError);
    expect(fromAlice.comments).toEqual([comment]);
  });

  it('only the asker accepts, and switching acceptance moves the 15 points', () => {
    const { question, fromAlice, fromBob } = askAndAnswer();
    expect(() => site.acceptAnswer(question.id, fromAlice.id, bob.id)).toThrow(NotQuestionAuthorError);

    site.acceptAnswer(question.id, fromAlice.id, asker.id);
    expect(alice.reputation).toBe(START + 15);

    const change = site.acceptAnswer(question.id, fromBob.id, asker.id);
    expect(change.previous).toBe(fromAlice);
    expect(question.acceptedAnswer).toBe(fromBob);
    expect([alice.reputation, bob.reputation]).toEqual([START, START + 15]);

    site.unacceptAnswer(question.id, asker.id);
    expect(bob.reputation).toBe(START);
    expect(question.acceptedAnswer).toBeNull();
  });

  it('gives no reputation for accepting your own answer and refuses foreign answers', () => {
    const { question } = askAndAnswer();
    const other = site.ask(alice.id, 'Other question', 'Body', ['misc']);
    const foreign = site.answer(other.id, bob.id, 'Answer elsewhere');
    const own = site.answer(question.id, asker.id, 'Answering myself');

    site.acceptAnswer(question.id, own.id, asker.id);
    expect(asker.reputation).toBe(START);
    expect(() => site.acceptAnswer(question.id, foreign.id, asker.id)).toThrow(AnswerNotOnQuestionError);
  });

  it('a closed question rejects answers until a moderator reopens it', () => {
    const { question } = askAndAnswer();
    expect(() => site.closeQuestion(question.id, alice.id)).toThrow(PermissionDeniedError);

    site.closeQuestion(question.id, mod.id);
    expect(() => site.answer(question.id, voter.id, 'Late answer')).toThrow(QuestionClosedError);
    site.vote(question.id, voter.id, VoteType.UP); // voting on closed questions is still allowed

    site.reopenQuestion(question.id, mod.id);
    expect(site.answer(question.id, voter.id, 'Now it works').questionId).toBe(question.id);
  });

  it('treats DELETED as terminal: no votes, no reopening, hidden from search', () => {
    const { question, fromBob } = askAndAnswer();
    expect(() => site.deletePost(fromBob.id, alice.id)).toThrow(PermissionDeniedError);

    site.deletePost(question.id, asker.id);
    expect(question.status).toBe(PostStatus.DELETED);
    expect(() => site.vote(question.id, voter.id, VoteType.UP)).toThrow(PostDeletedError);
    expect(() => site.reopenQuestion(question.id, mod.id)).toThrow(InvalidPostTransitionError);
    expect(site.search(new TagSearch('typescript'))).toEqual([]);
  });

  it('searches by tag, keyword and author, composed, best score first', () => {
    const debounce = site.ask(asker.id, 'Debounce vs throttle', 'When to debounce?', ['javascript']);
    clock.advanceMinutes(5);
    const typedDebounce = site.ask(alice.id, 'Typed debounce helper', 'Generic debounce in TS', ['typescript']);
    clock.advanceMinutes(5);
    const generics = site.ask(alice.id, 'Generic constraints', 'extends keyof', ['typescript']);
    site.vote(debounce.id, voter.id, VoteType.UP);

    expect(site.search(new TagSearch('TypeScript'))).toEqual([generics, typedDebounce]);
    expect(site.search(new KeywordSearch('DEBOUNCE'))).toEqual([debounce, typedDebounce]);
    expect(site.search(new AllOf(new TagSearch('typescript'), new KeywordSearch('debounce')))).toEqual([typedDebounce]);
    expect(site.search(new AnyOf(new AuthorSearch(asker.id), new KeywordSearch('keyof')))).toEqual([debounce, generics]);
  });

  it('adds badges by subscribing a listener, without touching the core', () => {
    const withBadges = new StackOverflow({
      clock,
      ids: new SequentialIdGenerator(),
      listeners: [new ReputationListener(), new BadgeListener()],
    });
    const a = withBadges.registerUser('a');
    const b = withBadges.registerUser('b');
    const question = withBadges.ask(a.id, 'Title', 'Body', ['tag']);
    const answer = withBadges.answer(question.id, b.id, 'Answer');

    withBadges.vote(answer.id, a.id, VoteType.UP);
    withBadges.acceptAnswer(question.id, answer.id, a.id);
    expect(b.badges).toEqual([Badge.TEACHER]);
    expect(a.badges).toEqual([Badge.SCHOLAR]);
    expect(b.reputation).toBe(START + 10 + 15);
  });

  it('throws for unknown users and posts', () => {
    expect(() => site.ask('ghost', 'Title', 'Body', ['tag'])).toThrow(UserNotFoundError);
    expect(() => site.vote('nope', voter.id, VoteType.UP)).toThrow(PostNotFoundError);
    expect(() => site.answer('nope', alice.id, 'Body')).toThrow(PostNotFoundError);
  });
});
