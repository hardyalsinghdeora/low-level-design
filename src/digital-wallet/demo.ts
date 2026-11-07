import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  BANK_CLEARING_ACCOUNT_ID,
  FEES_ACCOUNT_ID,
  PercentageFeePolicy,
  TieredDailyLimitPolicy,
  TransactionType,
  WalletService,
} from './index';

const clock = new FakeClock('2026-03-01T09:00:00Z');
const wallets = new WalletService({
  clock,
  ids: new SequentialIdGenerator(),
  feePolicy: new PercentageFeePolicy(100, [TransactionType.TRANSFER]), // 1% on transfers
  limitPolicy: new TieredDailyLimitPolicy({ [TransactionType.WITHDRAWAL]: 500_000 }), // Rs 5,000 per day
});
const system = (id: string) => formatMoney(wallets.ledger.account(id).balance);

function printBalances(): void {
  console.log(
    `  asha ${formatMoney(wallets.balanceOf('asha'))} | ravi ${formatMoney(wallets.balanceOf('ravi'))} | ` +
      `fees ${system(FEES_ACCOUNT_ID)} | bank ${system(BANK_CLEARING_ACCOUNT_ID)}`,
  );
}

console.log('\n--- Asha and Ravi open wallets; Asha tops up Rs 10,000 from her bank ---');
wallets.openWallet('asha');
wallets.openWallet('ravi');
wallets.topUp({ userId: 'asha', amount: 1_000_000, idempotencyKey: 'asha-topup-1' });
printBalances();

console.log('\n--- Asha pays Ravi Rs 2,500; the 1% fee makes it a three-line posting ---');
const payment = wallets.transfer({ fromUserId: 'asha', toUserId: 'ravi', amount: 250_000, idempotencyKey: 'order-42' });
for (const entry of wallets.ledger.entriesFor(payment.id)) {
  console.log(`  ${entry.direction.padEnd(6)} ${entry.accountId.padEnd(6)} ${formatMoney(entry.amount)}`);
}
printBalances();

console.log('\n--- The app timed out and retries with the same idempotency key ---');
const retry = wallets.transfer({ fromUserId: 'asha', toUserId: 'ravi', amount: 250_000, idempotencyKey: 'order-42' });
console.log(`  got ${retry.id} again (${retry.status}); the ledger still has ${wallets.ledger.entries.length} entries`);

console.log('\n--- Ravi tries to withdraw Rs 3,000 but only has Rs 2,500 ---');
try {
  wallets.withdraw({ userId: 'ravi', amount: 300_000, idempotencyKey: 'ravi-withdraw-1' });
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
const [failed] = wallets.history('ravi', { limit: 1 }).items;
console.log(`  ${failed.id} is ${failed.status} and posted ${wallets.ledger.entriesFor(failed.id).length} ledger entries`);

console.log('\n--- Asha paid the wrong person: support reverses the payment, fee included ---');
const reversal = wallets.reverse({ transactionId: payment.id, idempotencyKey: 'support-ticket-7' });
console.log(`  ${reversal.id} ${reversal.status}; ${payment.id} is now ${payment.status} (reversed by ${payment.reversedBy})`);
printBalances();

console.log('\n--- Daily withdrawal limit of Rs 5,000, reset at midnight UTC ---');
wallets.withdraw({ userId: 'asha', amount: 450_000, idempotencyKey: 'asha-withdraw-1' });
try {
  wallets.withdraw({ userId: 'asha', amount: 100_000, idempotencyKey: 'asha-withdraw-2' });
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
clock.set('2026-03-02T00:00:00Z');
wallets.withdraw({ userId: 'asha', amount: 100_000, idempotencyKey: 'asha-withdraw-3' });
console.log('  next day the same withdrawal succeeds');
printBalances();

console.log('\n--- Reconciliation ---');
wallets.ledger.verify();
const { debits, credits } = wallets.ledger.trialBalance();
console.log(`  debits ${formatMoney(debits)} = credits ${formatMoney(credits)}; cached balances match the entries`);
const page = wallets.history('asha', { limit: 3 });
console.log(`  asha's latest: ${page.items.map((t) => `${t.id} ${t.type} ${t.status}`).join(', ')}`);
console.log(`  next page cursor: ${page.nextCursor}`);
