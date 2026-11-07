import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Book,
  BookItem,
  BookNotFoundError,
  BorrowLimitReachedError,
  ByAuthor,
  CopyNotAvailableError,
  CopyNotFoundError,
  CopyStatus,
  DuplicateHoldError,
  HoldStatus,
  InvalidTransitionError,
  IsbnIs,
  Library,
  LibraryEventType,
  LoanStatus,
  Member,
  MemberInbox,
  MemberNotFoundError,
  MembershipNotActiveError,
  MembershipStatus,
  NoActiveLoanError,
  NoFineStrategy,
  OutstandingFinesError,
  PerDayCappedFineStrategy,
  RenewalBlockedByHoldError,
  RenewalLimitReachedError,
  TitleContains,
} from './index';

const CLEAN_CODE = '9780132350884';
const PATTERNS = '978-0-201-63361-0';
const DAY_HOURS = 24;

describe('Library', () => {
  let clock: FakeClock;
  let inbox: MemberInbox;
  let library: Library;

  beforeEach(() => {
    clock = new FakeClock('2026-04-01T10:00:00Z');
    inbox = new MemberInbox();
    library = new Library('Test Branch', {
      fineStrategy: new PerDayCappedFineStrategy(1_000, 20_000),
      clock,
      ids: new SequentialIdGenerator(),
    });
    library.subscribe(inbox);
    library
      .addBook(new Book(CLEAN_CODE, 'Clean Code', ['Robert C. Martin']))
      .addBook(new Book(PATTERNS, 'Design Patterns', ['Erich Gamma', 'Richard Helm']));
    library.addCopy('CC-1', CLEAN_CODE);
    library.addCopy('DP-1', PATTERNS);
    library.addCopy('DP-2', PATTERNS);
    library.addMember(new Member('asha', 'Asha', 2)).addMember(new Member('ben', 'Ben')).addMember(new Member('chen', 'Chen'));
  });

  it('lends a copy for 14 days and marks it LOANED', () => {
    const loan = library.borrow('asha', 'CC-1');
    expect(loan.dueAt.toISOString()).toBe('2026-04-15T10:00:00.000Z');
    expect(library.getCopy('CC-1').status).toBe(CopyStatus.LOANED);
    expect(library.getMember('asha').activeLoanCount).toBe(1);
    expect(() => library.borrow('ben', 'CC-1')).toThrow(CopyNotAvailableError);
  });

  it('enforces the borrow limit, membership state and known ids', () => {
    library.borrow('asha', 'DP-1');
    library.borrow('asha', 'DP-2');
    expect(() => library.borrow('asha', 'CC-1')).toThrow(BorrowLimitReachedError);

    library.getMember('ben').changeStatus(MembershipStatus.SUSPENDED);
    expect(() => library.borrow('ben', 'CC-1')).toThrow(MembershipNotActiveError);
    expect(() => library.borrow('nobody', 'CC-1')).toThrow(MemberNotFoundError);
    expect(() => library.borrow('chen', 'XX-9')).toThrow(CopyNotFoundError);
    expect(() => library.getBook('9780000000000')).toThrow(BookNotFoundError);
  });

  it('charges one day for returning one minute late, and nothing on time', () => {
    library.borrow('asha', 'DP-1');
    library.borrow('ben', 'DP-2');
    clock.advanceHours(14 * DAY_HOURS);
    expect(library.returnCopy('DP-1').fine).toBe(0);
    clock.advanceMinutes(1);
    const late = library.returnCopy('DP-2');
    expect(late).toMatchObject({ daysOverdue: 1, fine: 1_000, heldFor: null });
    expect(inbox.for('ben').map((e) => e.type)).toEqual([LibraryEventType.CHARGE_ADDED]);
  });

  it('caps the fine and blocks borrowing until it is paid', () => {
    library.borrow('asha', 'CC-1');
    clock.advanceHours(60 * DAY_HOURS);
    const receipt = library.returnCopy('CC-1');
    expect(receipt.daysOverdue).toBe(46);
    expect(receipt.fine).toBe(20_000);
    expect(() => library.borrow('asha', 'DP-1')).toThrow(OutstandingFinesError);
    library.payFine('asha', 20_000);
    expect(library.borrow('asha', 'DP-1').status).toBe(LoanStatus.ACTIVE);
  });

  it('a no-fine strategy never charges', () => {
    const lenient = new Library('Staff', { fineStrategy: new NoFineStrategy(), clock, ids: new SequentialIdGenerator() });
    lenient.addBook(new Book(CLEAN_CODE, 'Clean Code', ['Robert C. Martin'])).addMember(new Member('m', 'M'));
    lenient.addCopy('S-1', CLEAN_CODE);
    lenient.borrow('m', 'S-1');
    clock.advanceHours(90 * DAY_HOURS);
    expect(lenient.returnCopy('S-1').fine).toBe(0);
  });

  it('renews from the current due date at most twice', () => {
    library.borrow('asha', 'CC-1');
    clock.advanceHours(DAY_HOURS); // renewing early must not shorten the loan
    library.renew('CC-1');
    const loan = library.renew('CC-1');
    expect(loan.renewals).toBe(2);
    expect(loan.dueAt.toISOString()).toBe('2026-05-13T10:00:00.000Z');
    expect(() => library.renew('CC-1')).toThrow(RenewalLimitReachedError);
  });

  it('refuses a renewal while another member is waiting for the title', () => {
    library.borrow('asha', 'CC-1');
    library.placeHold('ben', CLEAN_CODE);
    expect(() => library.renew('CC-1')).toThrow(RenewalBlockedByHoldError);
    expect(() => library.placeHold('ben', CLEAN_CODE)).toThrow(DuplicateHoldError);
  });

  it('offers a returned copy to the first member in line and only to them', () => {
    library.borrow('asha', 'CC-1');
    const benHold = library.placeHold('ben', CLEAN_CODE);
    library.placeHold('chen', CLEAN_CODE);

    const receipt = library.returnCopy('CC-1');
    const copy = library.getCopy('CC-1');
    expect(receipt.heldFor).toBe('ben');
    expect(copy.status).toBe(CopyStatus.ON_HOLD);
    expect(benHold.status).toBe(HoldStatus.OFFERED);
    expect(inbox.for('ben').map((e) => e.type)).toEqual([LibraryEventType.HOLD_OFFERED]);
    expect(() => library.borrow('chen', 'CC-1')).toThrow(CopyNotAvailableError);

    library.borrow('ben', 'CC-1');
    expect(benHold.status).toBe(HoldStatus.FULFILLED);
    expect(copy.status).toBe(CopyStatus.LOANED);
  });

  it('passes a lapsed offer to the next member in line', () => {
    library.borrow('asha', 'CC-1');
    const benHold = library.placeHold('ben', CLEAN_CODE);
    library.placeHold('chen', CLEAN_CODE);
    library.returnCopy('CC-1');

    clock.advanceHours(3 * DAY_HOURS - 1);
    expect(library.expireHoldOffers()).toEqual([]);
    clock.advanceHours(1);
    expect(library.expireHoldOffers()).toEqual([benHold]);
    expect(benHold.status).toBe(HoldStatus.EXPIRED);
    expect(library.getCopy('CC-1').heldFor).toBe('chen');
    expect(inbox.for('ben').map((e) => e.type)).toContain(LibraryEventType.HOLD_EXPIRED);
    expect(() => library.borrow('ben', 'CC-1')).toThrow(CopyNotAvailableError);
  });

  it('a hold on a title with a copy on the shelf is offered at once', () => {
    const hold = library.placeHold('chen', PATTERNS);
    expect(hold.status).toBe(HoldStatus.OFFERED);
    expect(library.getCopy(hold.offeredBarcode ?? '').heldFor).toBe('chen');
  });

  it('a lost copy charges the replacement fee and leaves circulation until found', () => {
    library.borrow('asha', 'CC-1');
    expect(library.reportLost('CC-1')).toBe(50_000);
    const copy = library.getCopy('CC-1');
    expect(copy.status).toBe(CopyStatus.LOST);
    expect(library.getMember('asha').finesOwed).toBe(50_000);
    expect(() => library.returnCopy('CC-1')).toThrow(NoActiveLoanError);
    expect(() => library.borrow('ben', 'CC-1')).toThrow(CopyNotAvailableError);

    library.placeHold('ben', CLEAN_CODE);
    library.markFound('CC-1');
    expect(copy.status).toBe(CopyStatus.ON_HOLD);
    expect(copy.heldFor).toBe('ben');
  });

  it('rejects impossible copy and membership transitions', () => {
    const copy = new BookItem('X-1', CLEAN_CODE);
    expect(() => copy.checkIn()).toThrow(InvalidTransitionError);
    expect(() => copy.markFound()).toThrow(InvalidTransitionError);
    const member = new Member('z', 'Z');
    member.changeStatus(MembershipStatus.CLOSED);
    expect(() => member.changeStatus(MembershipStatus.ACTIVE)).toThrow(InvalidTransitionError);
  });

  it('searches with composable specifications and reports shelf availability', () => {
    library.borrow('asha', 'DP-1');
    const results = library.search(new ByAuthor('martin').or(new IsbnIs(PATTERNS)));
    expect(results.map((r) => [r.book.title, r.availableCopies, r.totalCopies])).toEqual([
      ['Clean Code', 1, 1],
      ['Design Patterns', 1, 2],
    ]);
    expect(library.search(new TitleContains('design').and(new ByAuthor('gamma').not()))).toEqual([]);
  });
});
