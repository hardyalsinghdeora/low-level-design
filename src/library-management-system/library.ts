import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { assertMoney, formatMoney, type Money } from '../shared/money';
import { type Book, normalizeIsbn } from './book';
import { BookItem, CopyStatus } from './book-item';
import {
  BookNotFoundError,
  CopyNotFoundError,
  MemberNotFoundError,
  NoActiveLoanError,
  RenewalBlockedByHoldError,
} from './errors';
import { LibraryEventType, type LibraryObserver } from './events';
import { Hold, HoldQueue } from './hold';
import { addDays, Loan, LoanStatus } from './loan';
import type { Member } from './member';
import type { Specification } from './search';
import type { FineStrategy } from './strategies/fine';

export interface LibraryOptions {
  fineStrategy: FineStrategy;
  clock?: Clock;
  ids?: IdGenerator;
  loanDays?: number;
  maxRenewals?: number;
  holdOfferDays?: number;
  lostItemFee?: Money;
}

export interface ReturnReceipt {
  loanId: string;
  barcode: string;
  memberId: string;
  returnedAt: Date;
  daysOverdue: number;
  fine: Money;
  /** The member the copy is now held for, or null when it went back on the shelf. */
  heldFor: string | null;
}

export interface SearchResult {
  book: Book;
  availableCopies: number;
  totalCopies: number;
}

/**
 * Aggregate root for one branch. It owns the catalog, copies, members, loans
 * and hold queues, and is the only place that changes several of them in one
 * step: lend, return, and pass a held copy down the line.
 */
export class Library {
  private readonly books = new Map<string, Book>();
  private readonly copies = new Map<string, BookItem>();
  private readonly members = new Map<string, Member>();
  private readonly activeLoans = new Map<string, Loan>(); // by barcode: at most one loan per copy
  private readonly holdQueues = new Map<string, HoldQueue>();
  private readonly observers = new Set<LibraryObserver>();
  private readonly fineStrategy: FineStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly loanDays: number;
  private readonly maxRenewals: number;
  private readonly holdOfferDays: number;
  private readonly lostItemFee: Money;

  constructor(
    readonly name: string,
    options: LibraryOptions,
  ) {
    this.fineStrategy = options.fineStrategy;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.loanDays = options.loanDays ?? 14;
    this.maxRenewals = options.maxRenewals ?? 2;
    this.holdOfferDays = options.holdOfferDays ?? 3;
    this.lostItemFee = options.lostItemFee ?? 50_000;
    assertMoney(this.lostItemFee, 'lostItemFee');
  }

  addBook(book: Book): this {
    if (this.books.has(book.isbn)) throw new RangeError(`Duplicate ISBN ${book.isbn}`);
    this.books.set(book.isbn, book);
    return this;
  }

  /** A new copy may immediately satisfy someone who is already waiting. */
  addCopy(barcode: string, isbn: string): BookItem {
    const book = this.getBook(isbn);
    if (this.copies.has(barcode)) throw new RangeError(`Duplicate barcode ${barcode}`);
    const copy = new BookItem(barcode, book.isbn);
    this.copies.set(barcode, copy);
    this.offerToNextInLine(copy);
    return copy;
  }

  addMember(member: Member): this {
    if (this.members.has(member.id)) throw new RangeError(`Duplicate member ${member.id}`);
    this.members.set(member.id, member);
    return this;
  }

  subscribe(observer: LibraryObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  getBook(isbn: string): Book {
    const book = this.books.get(normalizeIsbn(isbn));
    if (!book) throw new BookNotFoundError(isbn);
    return book;
  }

  getCopy(barcode: string): BookItem {
    const copy = this.copies.get(barcode);
    if (!copy) throw new CopyNotFoundError(barcode);
    return copy;
  }

  getMember(memberId: string): Member {
    const member = this.members.get(memberId);
    if (!member) throw new MemberNotFoundError(memberId);
    return member;
  }

  activeLoanFor(barcode: string): Loan {
    const loan = this.activeLoans.get(barcode);
    if (!loan) throw new NoActiveLoanError(barcode);
    return loan;
  }

  /** Desk flow: ask the member first, then the copy (its compare-and-set), then record the loan. */
  borrow(memberId: string, barcode: string): Loan {
    const member = this.getMember(memberId);
    const copy = this.getCopy(barcode);
    member.assertCanBorrow();
    const wasHeldForMember = copy.status === CopyStatus.ON_HOLD;
    copy.checkOut(member.id);

    const now = this.clock.now();
    const loan = new Loan(this.ids.next('LOAN'), copy.barcode, copy.isbn, member.id, now, addDays(now, this.loanDays));
    member.startLoan(loan.id);
    this.activeLoans.set(copy.barcode, loan);
    if (wasHeldForMember) this.queueFor(copy.isbn).activeFor(member.id)?.fulfil();
    return loan;
  }

  /** Refused while anyone is waiting for the title: renewing would jump the queue. */
  renew(barcode: string): Loan {
    const loan = this.activeLoanFor(barcode);
    this.getMember(loan.memberId).assertActive();
    if (this.queueFor(loan.isbn).waitingCount > 0) throw new RenewalBlockedByHoldError(loan.id, loan.isbn);
    loan.renew(this.loanDays, this.maxRenewals);
    return loan;
  }

  /** The fine is priced with the clock at the moment of return; the copy then goes to the next in line or the shelf. */
  returnCopy(barcode: string): ReturnReceipt {
    const loan = this.activeLoanFor(barcode);
    const copy = this.getCopy(barcode);
    const member = this.getMember(loan.memberId);
    const returnedAt = this.clock.now();
    const fine = this.fineStrategy.calculate(loan, returnedAt);

    loan.close(LoanStatus.RETURNED, returnedAt, fine);
    member.endLoan(loan.id, fine);
    this.activeLoans.delete(barcode);
    copy.checkIn();
    if (fine > 0) {
      this.publish(LibraryEventType.CHARGE_ADDED, member.id, `Fine of ${formatMoney(fine)} for "${this.titleOf(copy.isbn)}"`);
    }
    const heldFor = this.offerToNextInLine(copy);
    return { loanId: loan.id, barcode, memberId: member.id, returnedAt, daysOverdue: loan.daysOverdue(returnedAt), fine, heldFor };
  }

  /** The borrower pays the replacement fee and the copy leaves circulation until it is found. */
  reportLost(barcode: string): Money {
    const loan = this.activeLoanFor(barcode);
    const member = this.getMember(loan.memberId);
    loan.close(LoanStatus.LOST, this.clock.now(), this.lostItemFee);
    member.endLoan(loan.id, this.lostItemFee);
    this.activeLoans.delete(barcode);
    this.getCopy(barcode).reportLost();
    this.publish(LibraryEventType.CHARGE_ADDED, member.id, `Replacement fee of ${formatMoney(this.lostItemFee)} for copy ${barcode}`);
    return this.lostItemFee;
  }

  markFound(barcode: string): BookItem {
    const copy = this.getCopy(barcode);
    copy.markFound();
    this.offerToNextInLine(copy);
    return copy;
  }

  placeHold(memberId: string, isbn: string): Hold {
    const member = this.getMember(memberId);
    const book = this.getBook(isbn);
    member.assertActive();
    const hold = new Hold(this.ids.next('HOLD'), book.isbn, member.id, this.clock.now());
    this.queueFor(book.isbn).add(hold);
    const onShelf = this.copiesOf(book.isbn).find((copy) => copy.status === CopyStatus.AVAILABLE);
    if (onShelf) this.offerToNextInLine(onShelf);
    return hold;
  }

  /**
   * Evaluated on demand against the clock instead of one timer per offer: a
   * scheduler calls it, and every lapsed offer passes the copy down the line.
   */
  expireHoldOffers(): Hold[] {
    const now = this.clock.now();
    const expired: Hold[] = [];
    for (const queue of this.holdQueues.values()) {
      for (const hold of queue.expiredOffers(now)) {
        const barcode = hold.offeredBarcode;
        if (barcode === null) continue; // only OFFERED holds can lapse, and every offer names a copy
        const copy = this.getCopy(barcode);
        hold.expire();
        copy.releaseHold();
        expired.push(hold);
        this.publish(LibraryEventType.HOLD_EXPIRED, hold.memberId, `Your hold on "${this.titleOf(hold.isbn)}" expired`);
        this.offerToNextInLine(copy);
      }
    }
    return expired;
  }

  payFine(memberId: string, amount: Money): void {
    this.getMember(memberId).payFine(amount);
  }

  search(spec: Specification<Book>): SearchResult[] {
    return [...this.books.values()]
      .filter((book) => spec.isSatisfiedBy(book))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((book) => {
        const copies = this.copiesOf(book.isbn);
        const availableCopies = copies.filter((copy) => copy.status === CopyStatus.AVAILABLE).length;
        return { book, availableCopies, totalCopies: copies.length };
      });
  }

  /** Puts an AVAILABLE copy on hold for the oldest waiting member and notifies them. */
  private offerToNextInLine(copy: BookItem): string | null {
    if (copy.status !== CopyStatus.AVAILABLE) return null;
    const hold = this.holdQueues.get(copy.isbn)?.nextWaiting();
    if (!hold) return null;
    const expiresAt = addDays(this.clock.now(), this.holdOfferDays);
    copy.holdFor(hold.memberId);
    hold.offer(copy.barcode, expiresAt);
    this.publish(
      LibraryEventType.HOLD_OFFERED,
      hold.memberId,
      `"${this.titleOf(copy.isbn)}" (copy ${copy.barcode}) is held for you until ${expiresAt.toISOString()}`,
    );
    return hold.memberId;
  }

  private queueFor(isbn: string): HoldQueue {
    let queue = this.holdQueues.get(isbn);
    if (!queue) {
      queue = new HoldQueue(isbn);
      this.holdQueues.set(isbn, queue);
    }
    return queue;
  }

  private copiesOf(isbn: string): BookItem[] {
    return [...this.copies.values()].filter((copy) => copy.isbn === isbn);
  }

  private titleOf(isbn: string): string {
    return this.getBook(isbn).title;
  }

  private publish(type: LibraryEventType, memberId: string, message: string): void {
    const event = { type, memberId, at: this.clock.now(), message };
    for (const observer of this.observers) observer.onLibraryEvent(event);
  }
}
