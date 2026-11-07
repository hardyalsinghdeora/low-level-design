import { InvalidPlanChangeError, InvalidSubscriptionTransitionError } from './errors';
import { periodBoundary } from './billing-calendar';
import type { Plan } from './plan';

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
}

const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  [SubscriptionStatus.TRIALING]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.ACTIVE]: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.PAUSED, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.PAST_DUE]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.PAUSED]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.CANCELLED]: [],
};

/**
 * A customer's ongoing relationship with a plan. It owns the lifecycle and the
 * billing anchor; period boundaries are always derived from the anchor and the
 * period index, so they cannot drift however many renewals or plan changes happen.
 */
export class Subscription {
  private _status: SubscriptionStatus;
  private _plan: Plan;
  private _periodIndex = 0;
  private _cancelAtPeriodEnd = false;
  private _cancelledAt: Date | undefined;

  constructor(
    readonly id: string,
    readonly customerId: string,
    plan: Plan,
    /** First paid period starts here: sign-up time, or trial end. */
    readonly anchor: Date,
    readonly trialEnd: Date | undefined,
  ) {
    this._plan = plan;
    this._status = trialEnd ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
  }

  get status(): SubscriptionStatus {
    return this._status;
  }

  get plan(): Plan {
    return this._plan;
  }

  get periodIndex(): number {
    return this._periodIndex;
  }

  get currentPeriodStart(): Date {
    return periodBoundary(this.anchor, this._plan.interval, this._periodIndex);
  }

  get currentPeriodEnd(): Date {
    return periodBoundary(this.anchor, this._plan.interval, this._periodIndex + 1);
  }

  get cancelAtPeriodEnd(): boolean {
    return this._cancelAtPeriodEnd;
  }

  get cancelledAt(): Date | undefined {
    return this._cancelledAt;
  }

  /** Paid periods roll over in these states; a trial waits for its end, a cancelled one never rolls. */
  get isBillable(): boolean {
    return [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.PAUSED].includes(this._status);
  }

  activate(): void {
    this.transition(SubscriptionStatus.ACTIVE);
  }

  markPastDue(): void {
    this.transition(SubscriptionStatus.PAST_DUE);
  }

  pause(): void {
    this.transition(SubscriptionStatus.PAUSED);
  }

  resume(): void {
    if (this._status !== SubscriptionStatus.PAUSED) throw new InvalidSubscriptionTransitionError(this.id, this._status, 'ACTIVE (resume)');
    this.transition(SubscriptionStatus.ACTIVE);
  }

  cancel(at: Date): void {
    this.transition(SubscriptionStatus.CANCELLED);
    this._cancelledAt = at;
  }

  scheduleCancellation(): void {
    if (this._status === SubscriptionStatus.CANCELLED) {
      throw new InvalidSubscriptionTransitionError(this.id, this._status, 'cancel at period end');
    }
    this._cancelAtPeriodEnd = true;
  }

  advancePeriod(): void {
    if (!this.isBillable) throw new InvalidSubscriptionTransitionError(this.id, this._status, 'next period');
    this._periodIndex += 1;
  }

  /** Same interval only: the anchor and period boundaries stay as they are. */
  changePlan(plan: Plan): void {
    if (this._status !== SubscriptionStatus.ACTIVE && this._status !== SubscriptionStatus.TRIALING) {
      throw new InvalidPlanChangeError(`Subscription ${this.id} is ${this._status}; only active or trialing subscriptions change plan`);
    }
    if (plan.id === this._plan.id) throw new InvalidPlanChangeError(`Subscription ${this.id} is already on ${plan.id}`);
    if (plan.interval !== this._plan.interval) {
      throw new InvalidPlanChangeError(`Cannot switch ${this._plan.interval} to ${plan.interval} mid-period; schedule it for renewal`);
    }
    this._plan = plan;
  }

  private transition(to: SubscriptionStatus): void {
    if (!TRANSITIONS[this._status].includes(to)) throw new InvalidSubscriptionTransitionError(this.id, this._status, to);
    this._status = to;
  }
}
