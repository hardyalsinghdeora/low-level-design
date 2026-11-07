import type { Money } from '../shared/money';
import { InsufficientCashError, InvalidDenominationError, UnmakeableAmountError } from './errors';

export const RUPEE = 100;
export const NOTE_DENOMINATIONS: readonly Money[] = [2_000 * RUPEE, 500 * RUPEE, 200 * RUPEE, 100 * RUPEE];

/** Note counts keyed by denomination in paise. */
export type NoteBundle = Map<Money, number>;

/**
 * Chain of Responsibility: each cassette takes as many of its notes as it
 * can and hands the remainder to the next, smaller cassette. Planning is
 * separate from committing, so a failed plan never removes a note.
 */
export class NoteCassette {
  private next: NoteCassette | undefined;

  constructor(
    readonly denomination: Money,
    private notes: number,
  ) {}

  get count(): number {
    return this.notes;
  }

  setNext(next: NoteCassette): NoteCassette {
    this.next = next;
    return next;
  }

  /** Adds this cassette's share to `plan` and returns what is still left to dispense. */
  plan(amount: Money, plan: NoteBundle): Money {
    const take = Math.min(this.notes, Math.floor(amount / this.denomination));
    if (take > 0) plan.set(this.denomination, take);
    const remaining = amount - take * this.denomination;
    return remaining > 0 && this.next ? this.next.plan(remaining, plan) : remaining;
  }

  commit(plan: NoteBundle): void {
    this.notes -= plan.get(this.denomination) ?? 0;
    this.next?.commit(plan);
  }

  load(denomination: Money, count: number): void {
    if (denomination === this.denomination) this.notes += count;
    else if (this.next) this.next.load(denomination, count);
    else throw new InvalidDenominationError(denomination);
  }
}

/** The cash module: the head of the cassette chain plus totals. */
export class CashDispenser {
  private readonly cassettes: NoteCassette[];

  constructor(initial: Readonly<Record<number, number>> = {}, denominations: readonly Money[] = NOTE_DENOMINATIONS) {
    this.cassettes = [...denominations].sort((a, b) => b - a).map((d) => new NoteCassette(d, initial[d] ?? 0));
    this.cassettes.reduce((prev, cur) => prev.setNext(cur));
  }

  total(): Money {
    return this.cassettes.reduce((sum, c) => sum + c.denomination * c.count, 0);
  }

  inventory(): NoteBundle {
    return new Map(this.cassettes.map((c) => [c.denomination, c.count]));
  }

  dispense(amount: Money): NoteBundle {
    const head = this.cassettes[0];
    if (!head || amount > this.total()) throw new InsufficientCashError(amount, this.total());
    const plan: NoteBundle = new Map();
    if (amount <= 0 || head.plan(amount, plan) !== 0) throw new UnmakeableAmountError(amount);
    head.commit(plan);
    return plan;
  }

  load(notes: Readonly<Record<number, number>>): void {
    for (const [d, n] of Object.entries(notes)) this.cassettes[0]?.load(Number(d), n);
  }
}
