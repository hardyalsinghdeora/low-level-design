import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AllOf,
  BadgeListener,
  KeywordSearch,
  ReputationListener,
  StackOverflow,
  TagSearch,
  type User,
  VoteType,
} from './index';

const clock = new FakeClock('2026-05-01T10:00:00Z');
const site = new StackOverflow({
  clock,
  ids: new SequentialIdGenerator(),
  // Badges are just one more listener on the event bus.
  listeners: [new ReputationListener(), new BadgeListener()],
});

const asha = site.registerUser('asha');
const ben = site.registerUser('ben');
const chen = site.registerUser('chen');
const dev = site.registerUser('dev');
const mod = site.registerUser('mod', { moderator: true });

function printReputation(...users: User[]): void {
  for (const user of users) {
    const badges = user.badges.length ? ` [${user.badges.join(', ')}]` : '';
    console.log(`  ${user.name.padEnd(5)} rep ${String(user.reputation).padStart(3)}${badges}`);
  }
}

console.log('\n--- asha asks, ben and chen answer ---');
const question = site.ask(asha.id, 'How do I debounce a function in TypeScript?', 'I need a typed debounce helper.', [
  'TypeScript',
  'javascript',
]);
const benAnswer = site.answer(question.id, ben.id, 'Wrap a closure around a timer handle and clear it on each call.');
clock.advanceMinutes(3);
const chenAnswer = site.answer(question.id, chen.id, 'Use lodash.debounce, it is already typed.');
console.log(`  ${question.id} "${question.title}" tags: ${[...question.tags].join(', ')}`);
console.log(`  answers: ${question.answers.map((a) => `${a.id} by ${a.author.name}`).join(', ')}`);

console.log('\n--- Votes: dev upvotes ben, chen downvotes ben then changes their mind ---');
site.vote(benAnswer.id, dev.id, VoteType.UP);
site.vote(benAnswer.id, chen.id, VoteType.DOWN);
printReputation(ben, chen);
site.vote(benAnswer.id, chen.id, VoteType.UP); // the -2 / -1 is undone, then +10 applied
console.log(`  after the switch, ${benAnswer.id} score ${benAnswer.score}:`);
printReputation(ben, chen);

console.log('\n--- asha accepts chen, then switches acceptance to ben ---');
site.acceptAnswer(question.id, chenAnswer.id, asha.id);
printReputation(ben, chen);
site.acceptAnswer(question.id, benAnswer.id, asha.id);
console.log(`  accepted now: ${question.acceptedAnswer?.id}`);
printReputation(asha, ben, chen);

console.log('\n--- A moderator closes the question; a late answer is refused ---');
site.closeQuestion(question.id, mod.id);
try {
  site.answer(question.id, dev.id, 'Late answer');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
console.log(`  question status: ${question.status}`);

console.log('\n--- Search: tag "typescript" AND keyword "debounce" ---');
for (const hit of site.search(new AllOf(new TagSearch('typescript'), new KeywordSearch('debounce')))) {
  console.log(`  ${hit.id} score ${hit.score}: ${hit.title}`);
}
