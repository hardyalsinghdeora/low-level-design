import type { Clock } from '../shared/clock';
import type { IdGenerator } from '../shared/id-generator';
import { InvalidTransitionError, NothingToCookError, TicketNotFoundError } from './errors';
import type { Station } from './menu';
import type { TicketPrioritisationStrategy } from './strategies/kitchen-priority';

export enum TicketStatus {
  QUEUED = 'QUEUED',
  COOKING = 'COOKING',
  READY = 'READY',
}

/** One order line as the kitchen sees it: which station, how long it takes, and whom to tell when it is done. */
export class KitchenTicket {
  private _status = TicketStatus.QUEUED;
  private _readyAt: Date | null = null;

  constructor(
    readonly id: string,
    readonly sequence: number,
    readonly orderId: string,
    readonly tableId: string,
    readonly waiterId: string,
    readonly itemName: string,
    readonly quantity: number,
    readonly station: Station,
    readonly prepMinutes: number,
    readonly createdAt: Date,
  ) {}

  get status(): TicketStatus {
    return this._status;
  }

  get readyAt(): Date | null {
    return this._readyAt;
  }

  startCooking(): void {
    this.require(TicketStatus.QUEUED, 'start cooking');
    this._status = TicketStatus.COOKING;
  }

  markReady(at: Date): void {
    this.require(TicketStatus.COOKING, 'be marked ready');
    this._status = TicketStatus.READY;
    this._readyAt = at;
  }

  private require(expected: TicketStatus, attempted: string): void {
    if (this._status !== expected) throw new InvalidTransitionError('Ticket', this.id, this._status, attempted);
  }
}

/** Observer: the pass announces a finished ticket; the waiter's pager (or a screen) decides what to do with it. */
export interface KitchenObserver {
  onTicketReady(ticket: KitchenTicket): void;
}

export interface KitchenTicketFields {
  orderId: string;
  tableId: string;
  waiterId: string;
  itemName: string;
  quantity: number;
  station: Station;
  prepMinutes: number;
}

/**
 * The kitchen display. Tickets wait per station; which one a cook takes next
 * is a swappable Strategy (FIFO or shortest preparation first).
 */
export class KitchenQueue {
  private readonly tickets = new Map<string, KitchenTicket>();
  private readonly observers = new Set<KitchenObserver>();
  private sequence = 0;

  constructor(
    private strategy: TicketPrioritisationStrategy,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  setStrategy(strategy: TicketPrioritisationStrategy): void {
    this.strategy = strategy;
  }

  subscribe(observer: KitchenObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  submit(fields: KitchenTicketFields): KitchenTicket {
    this.sequence += 1;
    const t = new KitchenTicket(
      this.ids.next('TKT'),
      this.sequence,
      fields.orderId,
      fields.tableId,
      fields.waiterId,
      fields.itemName,
      fields.quantity,
      fields.station,
      fields.prepMinutes,
      this.clock.now(),
    );
    this.tickets.set(t.id, t);
    return t;
  }

  queued(station: Station): KitchenTicket[] {
    return [...this.tickets.values()].filter((t) => t.station === station && t.status === TicketStatus.QUEUED);
  }

  /** A cook at `station` pulls the next ticket chosen by the strategy. */
  next(station: Station): KitchenTicket {
    const waiting = this.queued(station);
    if (waiting.length === 0) throw new NothingToCookError(station);
    const ticket = this.strategy.pick(waiting);
    ticket.startCooking();
    return ticket;
  }

  markReady(ticketId: string): KitchenTicket {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);
    ticket.markReady(this.clock.now());
    for (const observer of this.observers) observer.onTicketReady(ticket);
    return ticket;
  }

  ticketsFor(orderId: string): KitchenTicket[] {
    return [...this.tickets.values()].filter((t) => t.orderId === orderId);
  }
}
