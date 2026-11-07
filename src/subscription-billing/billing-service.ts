import { SystemClock, type Clock } from '../shared/clock';
import { UuidGenerator, type IdGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { addDays, isoDay } from './billing-calendar';
import { InvalidPlanError, PlanNotFoundError, SubscriptionNotFoundError } from './errors';
import { Invoice, InvoiceStatus } from './invoice';
import type { PaymentGateway } from './payment-gateway';
import type { Plan } from './plan';
import { DailyProrationStrategy, type ProrationStrategy } from './strategies/proration';
import { FixedDaysRetrySchedule, type RetrySchedule } from './strategies/retry-schedule';
import { Subscription, SubscriptionStatus } from './subscription';

export interface BillingServiceOptions {
  gateway: PaymentGateway;
  clock?: Clock;
  ids?: IdGenerator;
  proration?: ProrationStrategy;
  retrySchedule?: RetrySchedule;
}

/**
 * Orchestrates plans, subscriptions, invoices and payments. Time only moves when
 * the caller says so (`runBilling(now)`, `runDunning(now)`), which is how a cron job
 * or queue worker would drive it and why every test can be exact about dates.
 */
export class BillingService {
  private readonly plans = new Map<string, Plan>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly invoicesByKey = new Map<string, Invoice>();
  private readonly credits = new Map<string, Money>();
  private readonly gateway: PaymentGateway;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly proration: ProrationStrategy;
  private readonly retrySchedule: RetrySchedule;

  constructor(options: BillingServiceOptions) {
    this.gateway = options.gateway;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.proration = options.proration ?? new DailyProrationStrategy();
    this.retrySchedule = options.retrySchedule ?? new FixedDaysRetrySchedule();
  }

  addPlan(plan: Plan): Plan {
    if (this.plans.has(plan.id)) throw new InvalidPlanError(`Plan ${plan.id} already exists`);
    this.plans.set(plan.id, plan);
    return plan;
  }

  plan(id: string): Plan {
    const plan = this.plans.get(id);
    if (!plan) throw new PlanNotFoundError(id);
    return plan;
  }

  subscription(id: string): Subscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new SubscriptionNotFoundError(id);
    return subscription;
  }

  invoicesFor(subscriptionId: string): Invoice[] {
    return [...this.invoicesByKey.values()].filter((invoice) => invoice.subscriptionId === subscriptionId);
  }

  creditBalance(customerId: string): Money {
    return this.credits.get(customerId) ?? 0;
  }

  /** Without a trial the first period is invoiced and charged immediately. */
  subscribe(customerId: string, planId: string): Subscription {
    const plan = this.plan(planId);
    const now = this.clock.now();
    const trialEnd = plan.trialDays > 0 ? addDays(now, plan.trialDays) : undefined;
    const subscription = new Subscription(this.ids.next('sub'), customerId, plan, trialEnd ?? now, trialEnd);
    this.subscriptions.set(subscription.id, subscription);
    if (!trialEnd) this.issuePeriodInvoice(subscription.id, now);
    return subscription;
  }

  /**
   * Idempotent: one invoice per subscription per period. Calling it again (a retried
   * job, two workers) returns the invoice that already exists and charges nothing.
   */
  issuePeriodInvoice(subscriptionId: string, now: Date = this.clock.now()): Invoice {
    const subscription = this.subscription(subscriptionId);
    const key = `${subscription.id}:period:${subscription.periodIndex}`;
    const existing = this.invoicesByKey.get(key);
    if (existing) return existing;

    const invoice = new Invoice(this.ids.next('inv'), key, subscription.id, subscription.customerId, now);
    const { plan, currentPeriodStart, currentPeriodEnd } = subscription;
    invoice.addLine({ description: `${plan.name} ${isoDay(currentPeriodStart)} to ${isoDay(currentPeriodEnd)}`, amount: plan.price });
    const credit = Math.min(this.creditBalance(subscription.customerId), invoice.total);
    if (credit > 0) {
      invoice.addLine({ description: 'Account credit applied', amount: -credit });
      this.credits.set(subscription.customerId, this.creditBalance(subscription.customerId) - credit);
    }
    return this.finalizeAndCollect(invoice, subscription, now);
  }

  /** Ends trials and rolls every billable subscription forward to `now`, one period at a time. */
  runBilling(now: Date = this.clock.now()): Invoice[] {
    const issued: Invoice[] = [];
    for (const subscription of this.subscriptions.values()) {
      if (subscription.status === SubscriptionStatus.TRIALING && subscription.trialEnd && now >= subscription.trialEnd) {
        if (subscription.cancelAtPeriodEnd) {
          subscription.cancel(subscription.trialEnd);
          continue;
        }
        subscription.activate();
        issued.push(this.issuePeriodInvoice(subscription.id, subscription.trialEnd));
      }
      while (subscription.isBillable && now >= subscription.currentPeriodEnd) {
        const boundary = subscription.currentPeriodEnd;
        if (subscription.cancelAtPeriodEnd) {
          subscription.cancel(boundary);
          break;
        }
        subscription.advancePeriod();
        if (subscription.status !== SubscriptionStatus.PAUSED) issued.push(this.issuePeriodInvoice(subscription.id, boundary));
      }
    }
    return issued;
  }

  /** Retries every open invoice whose next attempt is due. */
  runDunning(now: Date = this.clock.now()): Invoice[] {
    const due = [...this.invoicesByKey.values()].filter(
      (invoice) => invoice.status === InvoiceStatus.OPEN && invoice.nextAttemptAt !== undefined && invoice.nextAttemptAt <= now,
    );
    for (const invoice of due) this.collect(invoice, this.subscription(invoice.subscriptionId), now);
    return due;
  }

  /**
   * Switches plan now. The proration strategy prices the rest of the period; a net
   * credit (downgrade) goes to the customer's balance and is used by the next invoice.
   */
  changePlan(subscriptionId: string, planId: string, now: Date = this.clock.now()): Invoice | undefined {
    const subscription = this.subscription(subscriptionId);
    const oldPlan = subscription.plan;
    const newPlan = this.plan(planId);
    const trialing = subscription.status === SubscriptionStatus.TRIALING;
    subscription.changePlan(newPlan);
    if (trialing) return undefined; // nothing was paid yet, so nothing to prorate

    const lines = this.proration.lineItems({
      oldPlan, newPlan, periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd, changeAt: now,
    });
    if (lines.length === 0) return undefined;
    const id = this.ids.next('inv');
    const invoice = new Invoice(id, `${subscription.id}:change:${id}`, subscription.id, subscription.customerId, now);
    lines.forEach((line) => invoice.addLine(line));
    if (invoice.total < 0) {
      const credit = -invoice.total;
      this.credits.set(subscription.customerId, this.creditBalance(subscription.customerId) + credit);
      invoice.addLine({ description: 'Moved to account credit', amount: credit });
    }
    return this.finalizeAndCollect(invoice, subscription, now);
  }

  cancel(subscriptionId: string, options: { atPeriodEnd: boolean }): Subscription {
    const subscription = this.subscription(subscriptionId);
    if (options.atPeriodEnd) subscription.scheduleCancellation();
    else subscription.cancel(this.clock.now());
    return subscription;
  }

  pause(subscriptionId: string): Subscription {
    const subscription = this.subscription(subscriptionId);
    subscription.pause();
    return subscription;
  }

  resume(subscriptionId: string): Subscription {
    const subscription = this.subscription(subscriptionId);
    subscription.resume();
    return subscription;
  }

  private finalizeAndCollect(invoice: Invoice, subscription: Subscription, now: Date): Invoice {
    invoice.finalize();
    this.invoicesByKey.set(invoice.key, invoice);
    if (invoice.total === 0) invoice.markPaid(now);
    else this.collect(invoice, subscription, now);
    return invoice;
  }

  private collect(invoice: Invoice, subscription: Subscription, now: Date): void {
    const attempt = invoice.recordAttempt();
    const result = this.gateway.charge({
      customerId: invoice.customerId, amount: invoice.total, idempotencyKey: `${invoice.id}#${attempt}`,
    });
    if (result.success) {
      invoice.markPaid(now);
      const stillOwing = this.invoicesFor(subscription.id).some((other) => other.status === InvoiceStatus.OPEN);
      if (subscription.status === SubscriptionStatus.PAST_DUE && !stillOwing) subscription.activate();
      return;
    }
    const firstFailedAt = invoice.firstFailedAt ?? now;
    const next = this.retrySchedule.nextAttemptAt(firstFailedAt, attempt);
    invoice.recordFailure(now, next);
    if (next === undefined) {
      invoice.markUncollectible();
      if (subscription.status !== SubscriptionStatus.CANCELLED) subscription.cancel(now);
    } else if (subscription.status === SubscriptionStatus.ACTIVE) {
      subscription.markPastDue();
    }
  }
}
