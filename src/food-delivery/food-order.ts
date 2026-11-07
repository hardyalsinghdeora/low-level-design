import type { Money } from '../shared/money';
import { InvalidOrderTransitionError, UnauthorizedActorError } from './errors';
import type { Location } from './geo';

export enum FoodOrderStatus {
  PLACED = 'PLACED',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  PICKED_UP = 'PICKED_UP',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum ActorRole {
  CUSTOMER = 'CUSTOMER',
  RESTAURANT = 'RESTAURANT',
  PARTNER = 'PARTNER',
}

/** Who is asking. The order checks both the role and that it is *this* order's customer, restaurant or partner. */
export interface Actor {
  readonly role: ActorRole;
  readonly id: string;
}

const S = FoodOrderStatus;
const R = ActorRole;

/** Each edge lists who may take it. A customer can cancel until pickup starts; only the kitchen moves food forward. */
const TRANSITIONS: Record<FoodOrderStatus, Partial<Record<FoodOrderStatus, readonly ActorRole[]>>> = {
  [S.PLACED]: { [S.ACCEPTED]: [R.RESTAURANT], [S.CANCELLED]: [R.CUSTOMER, R.RESTAURANT] },
  [S.ACCEPTED]: { [S.PREPARING]: [R.RESTAURANT], [S.CANCELLED]: [R.CUSTOMER, R.RESTAURANT] },
  [S.PREPARING]: { [S.READY_FOR_PICKUP]: [R.RESTAURANT], [S.CANCELLED]: [R.CUSTOMER] },
  [S.READY_FOR_PICKUP]: { [S.PICKED_UP]: [R.PARTNER] },
  [S.PICKED_UP]: { [S.DELIVERED]: [R.PARTNER] },
  [S.DELIVERED]: {},
  [S.CANCELLED]: {},
};

export interface OrderLine {
  readonly itemId: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly quantity: number;
}

/** The order aggregate: lines, fees, the assigned partner, and the actor-aware state machine. */
export class FoodOrder {
  private _status = FoodOrderStatus.PLACED;
  private _partnerId: string | null = null;
  private _cancellationFee: Money = 0;
  private readonly _history: { status: FoodOrderStatus; at: Date; by: ActorRole }[];

  constructor(
    readonly id: string,
    readonly customerId: string,
    readonly restaurantId: string,
    readonly lines: readonly OrderLine[],
    readonly deliveryFee: Money,
    readonly dropOff: Location,
    readonly placedAt: Date,
  ) {
    this._history = [{ status: FoodOrderStatus.PLACED, at: placedAt, by: ActorRole.CUSTOMER }];
  }

  get itemTotal(): Money {
    return this.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  }

  get total(): Money {
    return this.itemTotal + this.deliveryFee;
  }

  get status(): FoodOrderStatus {
    return this._status;
  }

  get partnerId(): string | null {
    return this._partnerId;
  }

  get cancellationFee(): Money {
    return this._cancellationFee;
  }

  get history(): readonly { status: FoodOrderStatus; at: Date; by: ActorRole }[] {
    return this._history;
  }

  assignPartner(partnerId: string): void {
    if (this._partnerId) throw new RangeError(`Order ${this.id} already has partner ${this._partnerId}`);
    this._partnerId = partnerId;
  }

  transition(next: FoodOrderStatus, by: Actor, at: Date): void {
    const allowed = TRANSITIONS[this._status][next];
    if (!allowed) throw new InvalidOrderTransitionError(this.id, this._status, next);
    if (!allowed.includes(by.role) || !this.isParty(by)) throw new UnauthorizedActorError(this.id, `${by.role} ${by.id}`, next);
    this._status = next;
    this._history.push({ status: next, at, by: by.role });
  }

  cancel(by: Actor, fee: Money, at: Date): void {
    this.transition(FoodOrderStatus.CANCELLED, by, at);
    this._cancellationFee = fee;
  }

  private isParty(actor: Actor): boolean {
    switch (actor.role) {
      case ActorRole.CUSTOMER:
        return actor.id === this.customerId;
      case ActorRole.RESTAURANT:
        return actor.id === this.restaurantId;
      case ActorRole.PARTNER:
        return actor.id === this._partnerId;
    }
  }
}
