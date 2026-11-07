import { NoWaiterOnDutyError } from './errors';
import type { KitchenObserver, KitchenTicket } from './kitchen';

export class Waiter {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}

/** Strategy: who takes a newly opened table. Round robin is fair; "fewest open tables" is the usual alternative. */
export interface WaiterAssignmentStrategy {
  assign(waiters: readonly Waiter[]): Waiter;
}

export class RoundRobinAssignment implements WaiterAssignmentStrategy {
  private cursor = 0;

  assign(waiters: readonly Waiter[]): Waiter {
    if (waiters.length === 0) throw new NoWaiterOnDutyError();
    const waiter = waiters[this.cursor % waiters.length];
    this.cursor = (this.cursor + 1) % waiters.length;
    return waiter;
  }
}

/** In-memory pager: an Observer that collects "table T2: fries ready" messages per waiter. */
export class WaiterPager implements KitchenObserver {
  private readonly messages = new Map<string, string[]>();

  onTicketReady(ticket: KitchenTicket): void {
    const list = this.messages.get(ticket.waiterId) ?? [];
    list.push(`Table ${ticket.tableId}: ${ticket.quantity} x ${ticket.itemName} ready`);
    this.messages.set(ticket.waiterId, list);
  }

  for(waiterId: string): readonly string[] {
    return [...(this.messages.get(waiterId) ?? [])];
  }
}
