import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  FakeCardPayment,
  FlatOffCoupon,
  HasTag,
  InCategory,
  InMemoryOrderNotifier,
  InStock,
  OnlineShop,
  PercentOffCoupon,
  Product,
  UpiPayment,
} from './index';

const clock = new FakeClock('2026-06-01T10:00:00Z');
const notifier = new InMemoryOrderNotifier();
const shop = new OnlineShop({ clock, ids: new SequentialIdGenerator() });
shop.subscribe(notifier);
shop.catalog
  .add(new Product('phone', 'Pixel Phone', 'electronics', 1_500_000, ['5g']))
  .add(new Product('case', 'Phone Case', 'accessories', 99_900))
  .add(new Product('charger', 'Fast Charger', 'accessories', 149_900, ['5g']));
shop.inventory.restock('phone', 5);
shop.inventory.restock('case', 20);
shop.inventory.restock('charger', 1);
shop.registerCoupon(new FlatOffCoupon('FLAT500', 50_000, { minSubtotal: 200_000 }));
shop.registerCoupon(new PercentOffCoupon('TEN', 10, { maxDiscount: 100_000 }));

const stock = (id: string) => JSON.stringify(shop.inventory.levelOf(id));

console.log('\n--- Search: in-stock accessories, then 5G items ---');
const accessoriesInStock = new InCategory('accessories').and(new InStock(shop.inventory));
console.log(`  ${shop.catalog.search(accessoriesInStock).map((p) => p.name).join(', ')}`);
console.log(`  ${shop.catalog.search(new HasTag('5g')).map((p) => `${p.name} ${formatMoney(p.price)}`).join(', ')}`);

console.log('\n--- Asha fills her cart (two adds of the case merge) ---');
shop.addToCart('asha', 'phone');
shop.addToCart('asha', 'case');
shop.addToCart('asha', 'charger');
const cart = shop.addToCart('asha', 'case');
for (const l of cart.lines) console.log(`  ${l.quantity} x ${l.name} @ ${formatMoney(l.unitPrice)}`);

console.log('\n--- She places the order with two coupons; the app retries the same request ---');
const order = shop.placeOrder('asha', { idempotencyKey: 'checkout-1', couponCodes: ['TEN', 'FLAT500'] });
const retry = shop.placeOrder('asha', { idempotencyKey: 'checkout-1', couponCodes: ['TEN', 'FLAT500'] });
console.log(`  ${order.id} subtotal ${formatMoney(order.subtotal)}, coupons ${order.coupons.map((c) => `${c.code} -${formatMoney(c.discount)}`).join(', ')}`);
console.log(`  total ${formatMoney(order.total)}; retry returned ${retry.id}; phone stock ${stock('phone')}`);

console.log('\n--- Ben wants the last charger, which Asha has reserved ---');
shop.addToCart('ben', 'charger');
try {
  shop.placeOrder('ben', { idempotencyKey: 'ben-1' });
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- Card declined, UPI succeeds; stock moves from reserved to sold ---');
try {
  shop.pay(order.id, new FakeCardPayment('0002', () => false));
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message} -> still ${order.status}`);
}
shop.pay(order.id, new UpiPayment('asha@okbank'));
console.log(`  ${order.status} via ${order.payment?.method}; phone stock ${stock('phone')}`);

clock.advanceHours(30);
shop.ship(order.id);
shop.deliver(order.id);

console.log('\n--- Asha orders another case and cancels before paying ---');
shop.addToCart('asha', 'case', 3);
const second = shop.placeOrder('asha', { idempotencyKey: 'checkout-2' });
console.log(`  after placing: case stock ${stock('case')}`);
shop.cancel(second.id);
console.log(`  after cancel:  case stock ${stock('case')}`);

console.log(`\nAsha's notifications: ${notifier.inbox('asha').join(' | ')}`);
