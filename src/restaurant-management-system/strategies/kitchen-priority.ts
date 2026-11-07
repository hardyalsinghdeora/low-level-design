import type { KitchenTicket } from '../kitchen';

/**
 * Strategy: which queued ticket a station cooks next. Called with a non-empty
 * list of QUEUED tickets for one station.
 */
export interface TicketPrioritisationStrategy {
  pick(queued: readonly KitchenTicket[]): KitchenTicket;
}

function minBy(tickets: readonly KitchenTicket[], key: (t: KitchenTicket) => number): KitchenTicket {
  return tickets.reduce((best, t) => (key(t) < key(best) ? t : best));
}

/** First come, first cooked: fair, and no ticket waits forever. */
export class FifoPrioritisation implements TicketPrioritisationStrategy {
  pick(queued: readonly KitchenTicket[]): KitchenTicket {
    return minBy(queued, (t) => t.sequence);
  }
}

/**
 * Shortest preparation first (ties by arrival) minimises average wait, but a
 * slow dish can starve at a busy station; see the write-up for aging.
 */
export class ShortestPrepFirstPrioritisation implements TicketPrioritisationStrategy {
  pick(queued: readonly KitchenTicket[]): KitchenTicket {
    return minBy(queued, (t) => t.prepMinutes * 1_000_000 + t.sequence);
  }
}
