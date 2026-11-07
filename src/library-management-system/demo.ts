import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { Book, ByAuthor, IsbnIs, Library, Member, MemberInbox, PerDayCappedFineStrategy } from './index';

const clock = new FakeClock('2026-04-01T10:00:00Z');
const inbox = new MemberInbox();
const library = new Library('City Central Library', {
  fineStrategy: new PerDayCappedFineStrategy(1_000, 20_000), // Rs 10 per day late, never more than Rs 200
  clock,
  ids: new SequentialIdGenerator(),
});
library.subscribe(inbox);

const CLEAN_CODE = '978-0-13-235088-4';
library
  .addBook(new Book(CLEAN_CODE, 'Clean Code', ['Robert C. Martin']))
  .addBook(new Book('978-0-201-63361-0', 'Design Patterns', ['Erich Gamma', 'Richard Helm', 'Ralph Johnson', 'John Vlissides']))
  .addBook(new Book('978-0-13-475759-9', 'Refactoring', ['Martin Fowler']));
library.addCopy('CC-1', CLEAN_CODE);
library.addCopy('DP-1', '9780201633610');
library.addCopy('RF-1', '9780134757599');
library.addMember(new Member('asha', 'Asha', 2)).addMember(new Member('ben', 'Ben')).addMember(new Member('chen', 'Chen'));

function fail(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  }
}

console.log(`\n${library.name} - ${clock.now().toISOString()}`);
for (const result of library.search(new ByAuthor('martin').or(new IsbnIs('9780201633610')))) {
  console.log(`  ${result.book.title} (${result.book.authors[0]}): ${result.availableCopies}/${result.totalCopies} on the shelf`);
}

console.log('\n--- Asha borrows the only Clean Code; Ben and Chen join the hold queue ---');
const loan = library.borrow('asha', 'CC-1');
console.log(`  ${loan.id}: CC-1 to asha, due ${loan.dueAt.toISOString()}`);
library.placeHold('ben', CLEAN_CODE);
library.placeHold('chen', CLEAN_CODE);

console.log('\n--- Asha tries to renew while others are waiting ---');
fail(() => library.renew('CC-1'));

console.log('\n--- 17 days later Asha returns it: 3 days late, and it goes to Ben, not the shelf ---');
clock.advanceHours(17 * 24);
const receipt = library.returnCopy('CC-1');
console.log(`  ${receipt.daysOverdue} days late, fine ${formatMoney(receipt.fine)}, copy now held for ${receipt.heldFor}`);
for (const event of inbox.for('ben')) console.log(`  to ben: ${event.message}`);

console.log('\n--- Asha cannot borrow again until the fine is paid ---');
fail(() => library.borrow('asha', 'RF-1'));
library.payFine('asha', receipt.fine);
console.log(`  paid; ${library.borrow('asha', 'RF-1').id} issued for RF-1`);

console.log('\n--- Ben never collects; three days later the offer passes to Chen ---');
clock.advanceHours(3 * 24 + 1);
for (const hold of library.expireHoldOffers()) console.log(`  ${hold.id} for ${hold.memberId} is ${hold.status}`);
const copy = library.getCopy('CC-1');
console.log(`  CC-1 is ${copy.status} for ${copy.heldFor}`);
fail(() => library.borrow('ben', 'CC-1'));

console.log('\n--- Chen collects it, then reports it lost ---');
library.borrow('chen', 'CC-1');
const fee = library.reportLost('CC-1');
console.log(`  CC-1 is ${copy.status}; chen owes ${formatMoney(library.getMember('chen').finesOwed)} (replacement ${formatMoney(fee)})`);
