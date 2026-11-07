import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { BillingInterval, BillingService, FakePaymentGateway, Plan, type Invoice, type Subscription } from './index';

const clock = new FakeClock('2026-01-31T10:00:00Z');
const gateway = new FakePaymentGateway();
const billing = new BillingService({ gateway, clock, ids: new SequentialIdGenerator() });
billing.addPlan(new Plan('basic', 'Basic', 49_900, BillingInterval.MONTH));
billing.addPlan(new Plan('pro', 'Pro', 99_900, BillingInterval.MONTH, 14));

const day = (d: Date) => d.toISOString().slice(0, 10);
const printSub = (s: Subscription) =>
  console.log(`  ${s.id} ${s.customerId.padEnd(5)} ${s.plan.name.padEnd(5)} ${s.status.padEnd(9)} period ${day(s.currentPeriodStart)} -> ${day(s.currentPeriodEnd)}`);
const printInvoice = (i: Invoice) => {
  console.log(`  ${i.id} ${i.status.padEnd(6)} total ${formatMoney(i.total)}${i.nextAttemptAt ? `, retry ${day(i.nextAttemptAt)}` : ''}`);
  for (const line of i.lines) console.log(`      ${line.description.padEnd(38)} ${formatMoney(line.amount)}`);
};

console.log('\n--- 31 Jan: Asha takes Basic; Ravi starts a 14-day Pro trial ---');
const asha = billing.subscribe('asha', 'basic');
const ravi = billing.subscribe('ravi', 'pro');
billing.invoicesFor(asha.id).forEach(printInvoice);
[asha, ravi].forEach(printSub);

console.log('\n--- 14 Feb: Ravi\'s trial ends, but his card is declined ---');
gateway.declineNext(2);
billing.runBilling(new Date('2026-02-14T10:00:00Z')).forEach(printInvoice);
printSub(ravi);

console.log('\n--- 15 Feb (+1 day): dunning retries Ravi and is declined again ---');
billing.runDunning(new Date('2026-02-15T10:00:00Z')).forEach(printInvoice);

console.log('\n--- 17 Feb (+3 days): the retry succeeds and Ravi is ACTIVE again ---');
billing.runDunning(new Date('2026-02-17T10:00:00Z')).forEach(printInvoice);
printSub(ravi);

console.log('\n--- 28 Feb: Asha renews, because 31 Jan + 1 month = 28 Feb ---');
billing.runBilling(new Date('2026-02-28T10:00:00Z')).forEach(printInvoice);
printSub(asha);

console.log('\n--- 10 Mar: Asha upgrades to Pro mid-period; daily proration ---');
billing.changePlan(asha.id, 'pro', new Date('2026-03-10T10:00:00Z'));
billing.invoicesFor(asha.id).slice(-1).forEach(printInvoice);

console.log('\n--- Asha cancels at period end; on 31 Mar no renewal is issued ---');
billing.cancel(asha.id, { atPeriodEnd: true });
const issued = billing.runBilling(new Date('2026-03-31T10:00:00Z'));
console.log(`  renewals issued: ${issued.map((i) => `${i.id} for ${i.customerId}`).join(', ') || 'none'}`);
[asha, ravi].forEach(printSub);
console.log(`  gateway collected ${formatMoney(gateway.collected)} from ${gateway.attempts.length} attempts`);
