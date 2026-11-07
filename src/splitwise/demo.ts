import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { SplitType, Splitwise, type Debt } from './index';

const app = new Splitwise({ clock: new FakeClock('2026-03-01T09:00:00Z'), ids: new SequentialIdGenerator() });
for (const [id, name] of [['asha', 'Asha'], ['ravi', 'Ravi'], ['meera', 'Meera'], ['dev', 'Dev']]) app.addUser(id, name);
const trip = app.createGroup('Goa trip', ['asha', 'ravi', 'meera', 'dev']);
app.subscribe({ onExpenseEvent: (e) => console.log(`  [feed] ${e.type} "${e.expense.description}" v${e.expense.version} ${formatMoney(e.expense.amount)}`) });

const everyone = (...ids: string[]) => ids.map((userId) => ({ userId }));
const printDebts = (label: string, debts: Debt[]) => {
  console.log(`  ${label} (${debts.length} payments):`);
  for (const d of debts) console.log(`    ${d.from.padEnd(5)} -> ${d.to.padEnd(5)} ${formatMoney(d.amount)}`);
};
const printNets = () =>
  console.log('  nets: ' + ['asha', 'ravi', 'meera', 'dev'].map((u) => `${u} ${formatMoney(app.netBalance(u, trip.id))}`).join(' | '));

console.log('\n--- Asha pays the villa, Rs 12,000 split equally four ways ---');
app.addExpense({ description: 'Villa', paidBy: 'asha', amount: 1_200_000, splitType: SplitType.EQUAL, entries: everyone('asha', 'ravi', 'meera', 'dev'), groupId: trip.id });

console.log('\n--- Ravi pays dinner, Rs 1,000 among three: 33,334 + 33,333 + 33,333 paise ---');
const dinner = app.addExpense({ description: 'Dinner', paidBy: 'ravi', amount: 100_000, splitType: SplitType.EQUAL, entries: everyone('ravi', 'meera', 'dev'), groupId: trip.id });
console.log(`  shares: ${[...dinner.shares].map(([u, s]) => `${u} ${s}`).join(', ')}`);

console.log('\n--- Meera pays scuba, Rs 9,000 by percent 50 / 30 / 20 ---');
app.addExpense({
  description: 'Scuba', paidBy: 'meera', amount: 900_000, splitType: SplitType.PERCENT, groupId: trip.id,
  entries: [{ userId: 'dev', value: 50 }, { userId: 'meera', value: 30 }, { userId: 'ravi', value: 20 }],
});

console.log('\n--- Dev files a taxi with exact shares that do not add up ---');
try {
  app.addExpense({
    description: 'Taxi', paidBy: 'dev', amount: 150_000, splitType: SplitType.EXACT, groupId: trip.id,
    entries: [{ userId: 'dev', value: 50_000 }, { userId: 'asha', value: 50_000 }, { userId: 'ravi', value: 40_000 }],
  });
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message} -> nothing recorded, Dev fixes the numbers`);
}
app.addExpense({
  description: 'Taxi', paidBy: 'dev', amount: 150_000, splitType: SplitType.EXACT, groupId: trip.id,
  entries: [{ userId: 'dev', value: 50_000 }, { userId: 'asha', value: 50_000 }, { userId: 'ravi', value: 50_000 }],
});

console.log('\n--- Balances: pairwise debts vs greedy min-cash-flow ---');
printNets();
printDebts('pairwise', app.balanceSheet(trip.id).debts());
const plan = app.suggestedPayments(trip.id);
printDebts('simplified', plan);

console.log('\n--- Dinner was really Rs 1,200: edit recomputes every balance ---');
app.editExpense(dinner.id, { description: 'Dinner', paidBy: 'ravi', amount: 120_000, splitType: SplitType.EQUAL, entries: everyone('ravi', 'meera', 'dev'), groupId: trip.id }, dinner.version);
printNets();

console.log('\n--- Everyone pays along the simplified plan ---');
for (const d of app.suggestedPayments(trip.id)) app.settleUp(d.from, d.to, d.amount, trip.id);
printNets();
console.log(`  settled: ${app.balanceSheet(trip.id).isSettled}`);
