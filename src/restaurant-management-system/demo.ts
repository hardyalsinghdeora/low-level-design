import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  Menu, MenuCategory, MenuItem, PercentageServiceCharge, PercentageTax, Restaurant, ShortestPrepFirstPrioritisation,
  slotOf, Station, Table, Waiter, WaiterPager,
} from './index';

const clock = new FakeClock('2026-05-08T18:00:00Z');
const menu = new Menu()
  .add(new MenuItem('paneer', 'Paneer Tikka', MenuCategory.STARTER, 32_500, Station.GRILL, 15))
  .add(new MenuItem('fries', 'Masala Fries', MenuCategory.STARTER, 14_900, Station.FRY, 6))
  .add(new MenuItem('soda', 'Lime Soda', MenuCategory.DRINK, 9_900, Station.BAR, 2))
  .add(new MenuItem('lamb', 'Lamb Seekh', MenuCategory.MAIN, 45_000, Station.GRILL, 20));

const restaurant = new Restaurant('Saffron Grill', {
  menu,
  tax: new PercentageTax(500), // 5% GST
  serviceCharge: new PercentageServiceCharge(1_000), // 10%
  kitchenStrategy: new ShortestPrepFirstPrioritisation(),
  clock,
  ids: new SequentialIdGenerator(),
});
restaurant.addTable(new Table('T1', 2)).addTable(new Table('T2', 4)).addTable(new Table('T3', 8));
restaurant.addWaiter(new Waiter('w-ravi', 'Ravi')).addWaiter(new Waiter('w-meera', 'Meera'));
const pager = new WaiterPager();
restaurant.onTicketReady(pager);

console.log(`\n${restaurant.name} - ${clock.now().toISOString()}`);
console.log('\n--- Reservations over half-open slots ---');
const r1 = restaurant.reserve('Iyer', 4, slotOf(new Date('2026-05-08T19:00:00Z'), 120));
const r2 = restaurant.reserve('Khan', 4, slotOf(new Date('2026-05-08T21:00:00Z'), 90));
console.log(`  ${r1.guestName} -> ${r1.tableId} 19:00-21:00, ${r2.guestName} -> ${r2.tableId} 21:00-22:30 (back to back is fine)`);
const r3 = restaurant.reserve('Rao', 4, slotOf(new Date('2026-05-08T20:00:00Z'), 60));
console.log(`  ${r3.guestName} at 20:00 overlaps T2, so gets ${r3.tableId}`);

console.log('\n--- The lamb runs out; a walk-in party of 3 orders at T2 ---');
menu.setAvailability('lamb', false);
const order = restaurant.openOrder('T2', 3);
console.log(`  ${order.id} at ${order.tableId}, waiter ${order.waiterId}`);
try {
  restaurant.addItem(order.id, 'lamb');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
const paneer = restaurant.addItem(order.id, 'paneer');
const fries = restaurant.addItem(order.id, 'fries', 2);
const soda = restaurant.addItem(order.id, 'soda', 3);

console.log('\n--- Kitchen: shortest preparation first per station ---');
restaurant.sendToKitchen(order.id);
for (const station of [Station.BAR, Station.FRY, Station.GRILL]) {
  const ticket = restaurant.kitchen.next(station);
  clock.advanceMinutes(ticket.prepMinutes);
  restaurant.kitchen.markReady(ticket.id);
}
for (const message of pager.for(order.waiterId)) console.log(`  pager ${order.waiterId}: ${message}`);
restaurant.serve(order.id);

console.log('\n--- The bill, split equally and by item ---');
const bill = restaurant.bill(order.id);
console.log(`  subtotal ${formatMoney(bill.subtotal)} + service ${formatMoney(bill.serviceCharge)} + GST ${formatMoney(bill.tax)} = ${formatMoney(bill.total)}`);
console.log(`  equally among 3: ${bill.splitEqually(3).map((s) => formatMoney(s)).join(' / ')}`);
const shares = bill.splitByItems({ anu: [paneer.id], dev: [fries.id, soda.id] });
for (const [diner, share] of Object.entries(shares)) console.log(`  by item, ${diner} pays ${formatMoney(share)}`);
restaurant.pay(order.id, Object.values(shares).reduce((a, b) => a + b, 0));
console.log(`  ${order.id} is ${order.status}; T2 is free for the next guests`);
