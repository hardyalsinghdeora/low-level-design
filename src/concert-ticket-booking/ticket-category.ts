import { assertMoney, type Money } from '../shared/money';
import { InsufficientInventoryError, InvalidOrderError, SeatTakenError } from './errors';

export enum TicketTier {
  VIP = 'VIP',
  PREMIUM = 'PREMIUM',
  GENERAL = 'GENERAL',
}

export interface AllocationRequest {
  quantity: number;
  /** Only for reserved seating; when omitted the best free seats are picked. */
  seatIds?: string[];
}

/** What a category handed out: needed to give the exact same stock back on cancellation. */
export interface Allocation {
  tier: TicketTier;
  quantity: number;
  seatIds: string[];
}

/** Inventory for one price tier. Reserved seats and standing quantities share this contract. */
export interface TicketCategory {
  readonly tier: TicketTier;
  readonly price: Money;
  readonly available: number;
  allocate(request: AllocationRequest): Allocation;
  release(allocation: Allocation): void;
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new InvalidOrderError(`Quantity must be a positive integer, got ${quantity}`);
}

/** VIP: numbered seats; a seat is either free or sold. */
export class ReservedSeatingCategory implements TicketCategory {
  private readonly free: Set<string>;
  private readonly all: Set<string>;

  constructor(
    readonly tier: TicketTier,
    readonly price: Money,
    seatIds: string[],
  ) {
    assertMoney(price, 'price');
    this.all = new Set(seatIds);
    this.free = new Set(seatIds);
  }

  get available(): number {
    return this.free.size;
  }

  allocate(request: AllocationRequest): Allocation {
    assertQuantity(request.quantity);
    if (request.seatIds && request.seatIds.length !== request.quantity) {
      throw new InvalidOrderError(`Asked for ${request.quantity} seats but named ${request.seatIds.length}`);
    }
    if (!request.seatIds && this.free.size < request.quantity) {
      throw new InsufficientInventoryError(this.tier, request.quantity, this.free.size);
    }
    const seatIds = request.seatIds ?? [...this.free].sort().slice(0, request.quantity);
    if (new Set(seatIds).size !== seatIds.length) throw new InvalidOrderError('The same seat is named twice');
    for (const id of seatIds) if (!this.free.has(id)) throw new SeatTakenError(id);
    for (const id of seatIds) this.free.delete(id);
    return { tier: this.tier, quantity: seatIds.length, seatIds };
  }

  release(allocation: Allocation): void {
    for (const id of allocation.seatIds) if (this.all.has(id)) this.free.add(id);
  }
}

/** Premium and General: standing areas sold by quantity against a capacity. */
export class GeneralAdmissionCategory implements TicketCategory {
  private sold = 0;

  constructor(
    readonly tier: TicketTier,
    readonly price: Money,
    readonly capacity: number,
  ) {
    assertMoney(price, 'price');
  }

  get available(): number {
    return this.capacity - this.sold;
  }

  allocate(request: AllocationRequest): Allocation {
    assertQuantity(request.quantity);
    if (request.seatIds) throw new InvalidOrderError(`${this.tier} is unseated`);
    if (this.available < request.quantity) throw new InsufficientInventoryError(this.tier, request.quantity, this.available);
    this.sold += request.quantity;
    return { tier: this.tier, quantity: request.quantity, seatIds: [] };
  }

  release(allocation: Allocation): void {
    this.sold = Math.max(0, this.sold - allocation.quantity);
  }
}
