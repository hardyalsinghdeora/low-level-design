import { CategoryNotFoundError, EventNotOnSaleError, InvalidEventTransitionError } from './errors';
import type { TicketCategory, TicketTier } from './ticket-category';

export enum EventStatus {
  SCHEDULED = 'SCHEDULED',
  ON_SALE = 'ON_SALE',
  SOLD_OUT = 'SOLD_OUT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

const ALLOWED: Record<EventStatus, EventStatus[]> = {
  [EventStatus.SCHEDULED]: [EventStatus.ON_SALE, EventStatus.CANCELLED],
  [EventStatus.ON_SALE]: [EventStatus.SOLD_OUT, EventStatus.COMPLETED, EventStatus.CANCELLED],
  [EventStatus.SOLD_OUT]: [EventStatus.ON_SALE, EventStatus.COMPLETED, EventStatus.CANCELLED],
  [EventStatus.COMPLETED]: [],
  [EventStatus.CANCELLED]: [],
};

/**
 * A concert with tiered inventory and a lifecycle. SOLD_OUT is derived from
 * inventory but stored as a state so it can be shown, and it flips back to
 * ON_SALE when a cancellation returns stock to the public.
 */
export class ConcertEvent {
  private current = EventStatus.SCHEDULED;
  private readonly byTier = new Map<TicketTier, TicketCategory>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly venue: string,
    readonly startsAt: Date,
    categories: TicketCategory[],
    readonly perUserLimit: number,
  ) {
    for (const category of categories) this.byTier.set(category.tier, category);
  }

  get status(): EventStatus {
    return this.current;
  }

  get categories(): TicketCategory[] {
    return [...this.byTier.values()];
  }

  category(tier: TicketTier): TicketCategory {
    const category = this.byTier.get(tier);
    if (!category) throw new CategoryNotFoundError(this.id, tier);
    return category;
  }

  assertOnSale(): void {
    if (this.current !== EventStatus.ON_SALE) throw new EventNotOnSaleError(this.id, this.current);
  }

  openSales(): void {
    this.transition(EventStatus.ON_SALE);
    this.refreshAvailability();
  }

  /** Called after every allocation or release. */
  refreshAvailability(): void {
    const left = this.categories.reduce((sum, c) => sum + c.available, 0);
    if (this.current === EventStatus.ON_SALE && left === 0) this.transition(EventStatus.SOLD_OUT);
    else if (this.current === EventStatus.SOLD_OUT && left > 0) this.transition(EventStatus.ON_SALE);
  }

  complete(): void {
    this.transition(EventStatus.COMPLETED);
  }

  cancel(): void {
    this.transition(EventStatus.CANCELLED);
  }

  private transition(to: EventStatus): void {
    if (!ALLOWED[this.current].includes(to)) throw new InvalidEventTransitionError(this.id, this.current, to);
    this.current = to;
  }
}
