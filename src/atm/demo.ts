import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  Account,
  Atm,
  Card,
  CashDispenser,
  InMemoryBankService,
  InvalidPinError,
  RUPEE,
  UnmakeableAmountError,
  type NoteBundle,
} from './index';

const rs = (rupees: number) => rupees * RUPEE;
const notes = (bundle: NoteBundle) => [...bundle].map(([d, n]) => `${n} x ${formatMoney(d)}`).join(', ');

const clock = new FakeClock('2026-03-01T10:00:00Z');
const bank = new InMemoryBankService({ dailyWithdrawalLimit: rs(25_000), clock, ids: new SequentialIdGenerator() });
const card = new Card('4111000011112222', 'Asha Rao', new Date('2028-12-31T00:00:00Z'));
bank.openAccount(new Account('ACC-1', 'Asha Rao', rs(40_000))).registerCard(card, 'ACC-1', '4321');

const dispenser = new CashDispenser({ [rs(2_000)]: 5, [rs(500)]: 10, [rs(200)]: 10, [rs(100)]: 5 });
const atm = new Atm('ATM-MG-ROAD', { bank, dispenser, clock, ids: new SequentialIdGenerator() });

console.log(`\n${atm.id}: cash loaded ${formatMoney(dispenser.total())}`);

console.log('\n--- Asha inserts her card and mistypes the PIN once ---');
atm.insertCard(card);
try {
  atm.enterPin('4312');
} catch (error) {
  if (!(error instanceof InvalidPinError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
}
atm.enterPin('4321');
console.log(`  state ${atm.currentState}, balance ${formatMoney(atm.balance())}`);

console.log('\n--- Withdraw Rs 3,700 ---');
const receipt = atm.withdraw(rs(3_700));
console.log(`  dispensed ${notes(receipt.notes)}`);
console.log(`  balance ${formatMoney(receipt.balance)}, ATM cash ${formatMoney(dispenser.total())}`);

console.log('\n--- Withdraw Rs 150: debited, cannot be dispensed, reversed ---');
try {
  atm.withdraw(rs(150));
} catch (error) {
  if (!(error instanceof UnmakeableAmountError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
  console.log(`  balance still ${formatMoney(atm.balance())}`);
}

console.log('\n--- Deposit 3 x Rs 500 ---');
const deposit = atm.deposit({ [rs(500)]: 3 });
console.log(`  ${deposit.id} credited ${formatMoney(deposit.amount)}, balance ${formatMoney(deposit.balanceAfter)}`);

console.log('\n--- Mini statement (last 4) ---');
for (const t of atm.miniStatement(4)) {
  const ref = t.reverses ? ` (reverses ${t.reverses})` : '';
  console.log(`  ${t.id} ${t.type.padEnd(10)} ${formatMoney(t.amount).padStart(10)} -> ${formatMoney(t.balanceAfter)}${ref}`);
}

atm.ejectCard();
console.log(`\nCard ejected, ATM ${atm.currentState}`);
