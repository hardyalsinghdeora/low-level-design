import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney, type Money } from '../shared/money';
import { InsufficientChangeError, InsufficientFundsError, Inventory, Slot, VendingMachine } from './index';

const coins = (list: Money[]): string => (list.length ? list.map((c) => formatMoney(c)).join(' + ') : 'none');

const inventory = new Inventory()
  .addSlot(new Slot('A1', { sku: 'CHIPS', name: 'Chips', price: 1_500 }, 5, 2))
  .addSlot(new Slot('A2', { sku: 'SODA', name: 'Soda', price: 2_500 }, 5, 1))
  .addSlot(new Slot('B1', { sku: 'CHOC', name: 'Chocolate', price: 4_000 }, 5, 0));

const machine = new VendingMachine('Lobby snack machine', {
  inventory,
  coinStock: { 500: 1, 200: 2 },
  clock: new FakeClock('2026-03-01T09:00:00Z'),
  ids: new SequentialIdGenerator(),
});

function show(label: string): void {
  console.log(`  [${machine.currentState}] ${label} | cash box ${formatMoney(machine.coins.total())}`);
}

console.log(`\n${machine.name}`);
for (const s of inventory.snapshot()) console.log(`  ${s.code} ${s.name} ${formatMoney(s.price)} x${s.quantity}`);

console.log('\n--- Rs 20 note for Chips (Rs 15): Rs 5 change ---');
machine.insertMoney(2_000);
machine.selectProduct('A1');
let result = machine.dispense();
show(`${result.product.name}, change ${coins(result.change)}`);

console.log('\n--- Rs 50 note for Soda (Rs 25): the box cannot make Rs 25 ---');
machine.insertMoney(5_000);
try {
  machine.selectProduct('A2');
} catch (error) {
  if (!(error instanceof InsufficientChangeError)) throw error;
  show(`${error.name}: refunded ${coins([...error.refund])}`);
}

console.log('\n--- Customer pays exact money instead ---');
for (const c of [1_000, 1_000, 500]) machine.insertMoney(c);
machine.selectProduct('A2');
result = machine.dispense();
show(`${result.product.name}, change ${coins(result.change)}`);

console.log('\n--- Rs 10 is not enough for the last Chips; add Rs 5 ---');
machine.insertMoney(1_000);
try {
  machine.selectProduct('A1');
} catch (error) {
  if (!(error instanceof InsufficientFundsError)) throw error;
  show(`${error.name}: inserted ${formatMoney(error.inserted)} of ${formatMoney(error.price)}`);
}
machine.insertMoney(500);
machine.selectProduct('A1');
result = machine.dispense();
show(`${result.product.name}, change ${coins(result.change)}`);

console.log('\n--- Everything sold: coins are refused until the operator restocks ---');
try {
  machine.insertMoney(1_000);
} catch (error) {
  show(`${(error as Error).name}: ${(error as Error).message}`);
}
machine.restock('B1', 3);
show('restocked B1 x3');
console.log(`\nSales: ${machine.sales().map((s) => `${s.id} ${s.productName}`).join(', ')}`);
