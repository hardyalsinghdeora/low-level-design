import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  addMonthsAnchored,
  BillingInterval,
  BillingService,
  FakePaymentGateway,
  InvalidInvoiceTransitionError,
  InvalidPlanChangeError,
  InvalidPlanError,
  InvalidSubscriptionTransitionError,
  Invoice,
  InvoiceLockedError,
  InvoiceStatus,
  NoProrationStrategy,
  periodBoundary,
  Plan,
  PlanNotFoundError,
  SubscriptionNotFoundError,
  SubscriptionStatus,
  unusedValue,
  type ProrationStrategy,
} from './index';

const at = (iso: string) => new Date(iso);

function build(proration?: ProrationStrategy, start = '2026-03-01T09:00:00Z') {
  const clock = new FakeClock(start);
  const gateway = new FakePaymentGateway();
  const billing = new BillingService({ gateway, clock, ids: new SequentialIdGenerator(), proration });
  billing.addPlan(new Plan('basic', 'Basic', 10_000, BillingInterval.MONTH));
  billing.addPlan(new Plan('pro', 'Pro', 20_000, BillingInterval.MONTH));
  billing.addPlan(new Plan('trial', 'Pro with trial', 20_000, BillingInterval.MONTH, 14));
  billing.addPlan(new Plan('annual', 'Annual', 100_000, BillingInterval.YEAR));
  return { clock, gateway, billing };
}

describe('billing periods', () => {
  it('clamps to short months but stays anchored to the original day', () => {
    const jan31 = at('2026-01-31T10:00:00Z');
    expect([1, 2, 3].map((m) => addMonthsAnchored(jan31, m).toISOString())).toEqual([
      '2026-02-28T10:00:00.000Z', '2026-03-31T10:00:00.000Z', '2026-04-30T10:00:00.000Z',
    ]);
    expect(addMonthsAnchored(at('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    const leapDay = at('2028-02-29T00:00:00Z');
    expect(periodBoundary(leapDay, BillingInterval.YEAR, 1).toISOString()).toBe('2029-02-28T00:00:00.000Z');
    expect(periodBoundary(leapDay, BillingInterval.YEAR, 4).toISOString()).toBe('2032-02-29T00:00:00.000Z');
  });

  it('invoices at sign-up and renews exactly at each boundary', () => {
    const { billing } = build(undefined, '2026-01-31T10:00:00Z');
    const sub = billing.subscribe('asha', 'basic');
    const [first] = billing.invoicesFor(sub.id);
    expect(first.status).toBe(InvoiceStatus.PAID);
    expect(first.lines[0].description).toBe('Basic 2026-01-31 to 2026-02-28');
    expect(billing.runBilling(at('2026-02-28T09:59:59Z'))).toHaveLength(0);
    expect(billing.runBilling(at('2026-03-31T10:00:00Z'))).toHaveLength(2); // catches up two periods
    expect(sub.currentPeriodStart.toISOString()).toBe('2026-03-31T10:00:00.000Z');
    expect(sub.currentPeriodEnd.toISOString()).toBe('2026-04-30T10:00:00.000Z');
  });

  it('generates exactly one invoice per subscription per period', () => {
    const { billing, gateway } = build();
    const sub = billing.subscribe('asha', 'basic');
    expect(billing.issuePeriodInvoice(sub.id).id).toBe(billing.issuePeriodInvoice(sub.id).id);
    billing.runBilling(at('2026-04-01T09:00:00Z'));
    expect(billing.runBilling(at('2026-04-01T09:00:00Z'))).toEqual([]);
    expect(billing.invoicesFor(sub.id)).toHaveLength(2);
    expect(gateway.attempts).toHaveLength(2);
  });

  it('moves a trial to active at trial end and anchors billing there', () => {
    const { billing } = build();
    const sub = billing.subscribe('ravi', 'trial');
    expect(sub.status).toBe(SubscriptionStatus.TRIALING);
    expect(billing.runBilling(at('2026-03-14T23:00:00Z'))).toHaveLength(0);
    const [invoice] = billing.runBilling(at('2026-03-15T09:00:00Z'));
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
    expect(invoice.total).toBe(20_000);
    expect(sub.currentPeriodEnd.toISOString()).toBe('2026-04-15T09:00:00.000Z');
  });
});

describe('plan changes', () => {
  it('allocates a price across days so the remainder is never lost', () => {
    expect([1, 2, 3].map((days) => unusedValue(100, 3, days))).toEqual([33, 66, 100]); // days are 34, 33, 33
    expect(unusedValue(10_000, 31, 0)).toBe(0);
  });

  it('daily proration credits unused old-plan days and charges new-plan days exactly', () => {
    const { billing, gateway } = build();
    const sub = billing.subscribe('asha', 'basic'); // 1 Mar - 1 Apr, 31 days
    const invoice = billing.changePlan(sub.id, 'pro', at('2026-03-11T09:00:00Z')); // 10 days used, 21 left
    // Basic 10,000 / 31 days = 322 a day, first 18 days 323: days 11-31 are worth 8 x 323 + 13 x 322 = 6,770.
    // Pro 20,000 / 31 = 645 a day, first 5 days 646: the last 21 days are 21 x 645 = 13,545.
    expect(invoice?.lines.map((l) => l.amount)).toEqual([-6_770, 13_545]);
    expect(invoice?.status).toBe(InvoiceStatus.PAID);
    expect(gateway.collected).toBe(10_000 + 6_775);
    expect(sub.plan.id).toBe('pro');
  });

  it('a downgrade becomes account credit that the next invoice uses', () => {
    const { billing, gateway } = build();
    const sub = billing.subscribe('asha', 'pro');
    const invoice = billing.changePlan(sub.id, 'basic', at('2026-03-11T09:00:00Z'));
    expect(invoice?.total).toBe(0);
    expect(billing.creditBalance('asha')).toBe(6_775);
    const [renewal] = billing.runBilling(at('2026-04-01T09:00:00Z'));
    expect(renewal.lines.map((l) => l.amount)).toEqual([10_000, -6_775]);
    expect(gateway.collected).toBe(20_000 + 3_225);
    expect(billing.creditBalance('asha')).toBe(0);
  });

  it('without proration the new price simply starts at renewal', () => {
    const { billing } = build(new NoProrationStrategy());
    const sub = billing.subscribe('asha', 'basic');
    expect(billing.changePlan(sub.id, 'pro', at('2026-03-11T09:00:00Z'))).toBeUndefined();
    expect(billing.runBilling(at('2026-04-01T09:00:00Z'))[0].total).toBe(20_000);
  });

  it('rejects interval switches, no-op changes and unknown ids', () => {
    const { billing } = build();
    const sub = billing.subscribe('asha', 'basic');
    expect(() => billing.changePlan(sub.id, 'annual')).toThrow(InvalidPlanChangeError);
    expect(() => billing.changePlan(sub.id, 'basic')).toThrow(InvalidPlanChangeError);
    expect(() => billing.changePlan(sub.id, 'gold')).toThrow(PlanNotFoundError);
    expect(() => billing.cancel('sub-404', { atPeriodEnd: true })).toThrow(SubscriptionNotFoundError);
    expect(() => new Plan('x', 'X', 99.5, BillingInterval.MONTH)).toThrow(InvalidPlanError);
  });
});

describe('dunning and lifecycle', () => {
  it('retries +1 and +3 days after the first failure, then recovers to ACTIVE', () => {
    const { billing, gateway } = build();
    gateway.declineNext(2);
    const sub = billing.subscribe('dev', 'basic');
    const [invoice] = billing.invoicesFor(sub.id);
    expect(sub.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(invoice.nextAttemptAt?.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(billing.runDunning(at('2026-03-02T08:59:00Z'))).toHaveLength(0);
    billing.runDunning(at('2026-03-02T09:00:00Z'));
    expect(invoice.nextAttemptAt?.toISOString()).toBe('2026-03-04T09:00:00.000Z');
    billing.runDunning(at('2026-03-04T09:00:00Z'));
    expect(invoice.status).toBe(InvoiceStatus.PAID);
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('gives up after the +7 day retry: invoice uncollectible, subscription cancelled', () => {
    const { billing, gateway } = build();
    gateway.setDeclineAll(true);
    const sub = billing.subscribe('dev', 'basic');
    for (const day of ['02', '04', '08']) billing.runDunning(at(`2026-03-${day}T09:00:00Z`));
    const [invoice] = billing.invoicesFor(sub.id);
    expect(invoice.attempts).toBe(4);
    expect(invoice.status).toBe(InvoiceStatus.UNCOLLECTIBLE);
    expect(sub.status).toBe(SubscriptionStatus.CANCELLED);
    expect(billing.runBilling(at('2026-04-01T09:00:00Z'))).toEqual([]);
  });

  it('cancel at period end keeps access until the boundary and issues no renewal', () => {
    const { billing } = build();
    const sub = billing.subscribe('meera', 'basic');
    billing.cancel(sub.id, { atPeriodEnd: true });
    expect(billing.runBilling(at('2026-03-31T09:00:00Z'))).toEqual([]);
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
    expect(billing.runBilling(at('2026-04-01T09:00:00Z'))).toEqual([]);
    expect(sub.status).toBe(SubscriptionStatus.CANCELLED);
    expect(sub.cancelledAt?.toISOString()).toBe('2026-04-01T09:00:00.000Z');
    expect(() => billing.cancel(sub.id, { atPeriodEnd: false })).toThrow(InvalidSubscriptionTransitionError);
  });

  it('a paused subscription rolls its periods without invoicing them', () => {
    const { billing } = build();
    const sub = billing.subscribe('asha', 'basic');
    expect(() => billing.resume(sub.id)).toThrow(InvalidSubscriptionTransitionError);
    billing.pause(sub.id);
    expect(billing.runBilling(at('2026-04-01T09:00:00Z'))).toEqual([]);
    billing.resume(sub.id);
    const [invoice] = billing.runBilling(at('2026-05-01T09:00:00Z'));
    expect(invoice.key).toBe(`${sub.id}:period:2`);
    expect(billing.invoicesFor(sub.id)).toHaveLength(2);
  });

  it('locks finalized invoices, validates their transitions and keeps gateway charges idempotent', () => {
    const invoice = new Invoice('inv', 'k', 'sub', 'c', at('2026-03-01T00:00:00Z'));
    invoice.addLine({ description: 'Basic', amount: 10_000 });
    invoice.finalize();
    expect(() => invoice.addLine({ description: 'Extra', amount: 1 })).toThrow(InvoiceLockedError);
    invoice.markPaid(at('2026-03-01T00:00:00Z'));
    expect(() => invoice.void()).toThrow(InvalidInvoiceTransitionError);
    const gateway = new FakePaymentGateway();
    const request = { customerId: 'c', amount: 500, idempotencyKey: 'inv#1' };
    expect(gateway.charge(request)).toBe(gateway.charge(request));
    expect(gateway.attempts).toHaveLength(1);
  });
});
