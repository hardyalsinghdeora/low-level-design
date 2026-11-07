import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  CardPayment,
  CashPayment,
  CoffeeMachine,
  ExtraShot,
  Ingredient,
  IngredientInventory,
  InsufficientIngredientError,
  MaintenancePanel,
  PrepaidCard,
  Sugar,
  UNIT,
} from './index';

const clock = new FakeClock('2026-03-01T08:00:00Z');
const inventory = new IngredientInventory(
  {
    [Ingredient.COFFEE_BEANS]: { quantity: 200, capacity: 500, lowStockThreshold: 50 },
    [Ingredient.WATER]: { quantity: 2_000, capacity: 2_000, lowStockThreshold: 300 },
    [Ingredient.MILK]: { quantity: 450, capacity: 1_000, lowStockThreshold: 200 },
    [Ingredient.SUGAR]: { quantity: 100, capacity: 200, lowStockThreshold: 20 },
  },
  { clock },
);
const panel = new MaintenancePanel();
inventory.subscribe({
  onLowStock: (e) => console.log(`  ! low stock: ${e.ingredient} at ${e.remaining}${UNIT[e.ingredient]}`),
});
inventory.subscribe(panel);
const machine = new CoffeeMachine({ inventory, clock, ids: new SequentialIdGenerator() });

console.log('\nOffice coffee machine menu');
for (const item of machine.menu()) console.log(`  ${item.name.padEnd(11)} ${formatMoney(item.price)}`);

console.log('\n--- Latte with an extra shot and sugar, paid in cash ---');
const fancy = new Sugar(new ExtraShot(machine.brew('Latte')));
const first = machine.prepare(fancy, new CashPayment(30_000));
console.log(`  ${first.id}: ${first.description} = ${formatMoney(first.price)}, change ${formatMoney(first.payment.change)}`);

console.log('\n--- Cappuccino on a prepaid card (milk crosses its threshold) ---');
const card = new PrepaidCard('CARD-7', 50_000);
clock.advanceMinutes(5);
const second = machine.prepare(machine.brew('Cappuccino'), new CardPayment(card));
console.log(`  ${second.id}: ${second.description}, card balance now ${formatMoney(card.balance)}`);

console.log('\n--- Another latte: only 130ml milk left, so nothing is consumed or charged ---');
try {
  machine.prepare(machine.brew('Latte'), new CardPayment(card));
} catch (error) {
  if (!(error instanceof InsufficientIngredientError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
  console.log(`  card balance still ${formatMoney(card.balance)}, milk still ${inventory.level(Ingredient.MILK)}ml`);
}
console.log(`  menu now: ${machine.menu().map((m) => `${m.name}${m.available ? '' : ' (unavailable)'}`).join(', ')}`);

console.log('\n--- Operator refills milk, latte works again ---');
inventory.refill(Ingredient.MILK, 600);
const third = machine.prepare(machine.brew('Latte'), new CardPayment(card));
console.log(`  ${third.id}: ${third.description}, card balance ${formatMoney(card.balance)}`);

console.log(`\nMaintenance panel alerts: ${panel.alerts.map((a) => a.ingredient).join(', ')}`);
console.log(`Orders served: ${machine.orders().length}`);
