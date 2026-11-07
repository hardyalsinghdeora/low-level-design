import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  type Actor,
  ActorRole,
  DeliveryPartner,
  DistancePricing,
  FoodDeliveryService,
  OpeningHours,
  RecordingObserver,
  Restaurant,
  SurgePricing,
} from './index';

const clock = new FakeClock('2026-07-01T09:45:00Z');
const observer = new RecordingObserver();
// Dinner rush: 1.5x surge from 19:00 to 21:00 UTC.
const surge = (at: Date) => (at.getUTCHours() >= 19 && at.getUTCHours() < 21 ? 150 : 100);
const service = new FoodDeliveryService({
  pricing: new SurgePricing(new DistancePricing(2_000, 1_000), surge),
  clock,
  ids: new SequentialIdGenerator(),
});
service.subscribe(observer);

const paradise = new Restaurant('R1', 'Paradise Biryani', { x: 0, y: 0 }, new OpeningHours([{ open: '10:00', close: '23:00' }]))
  .addItem('biryani', 'Chicken Biryani', 25_000)
  .addItem('naan', 'Butter Naan', 4_000);
service.addRestaurant(paradise);
const ravi = new DeliveryPartner('P1', 'Ravi', { x: 1, y: 0 }, 4.2);
const meera = new DeliveryPartner('P2', 'Meera', { x: 3, y: 1 }, 4.9);
service.addPartner(ravi).addPartner(meera);
ravi.goOnline();
meera.goOnline();

const kitchen: Actor = { role: ActorRole.RESTAURANT, id: 'R1' };
const asha: Actor = { role: ActorRole.CUSTOMER, id: 'asha' };
const request = { customerId: 'asha', restaurantId: 'R1', items: [{ itemId: 'biryani', quantity: 2 }, { itemId: 'naan', quantity: 3 }], dropOff: { x: 4, y: 3 } };

console.log('\n--- 09:45: Asha tries to order before opening ---');
try {
  service.placeOrder(request);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- 19:30: dinner order during surge ---');
clock.set('2026-07-01T19:30:00Z');
const order = service.placeOrder(request);
console.log(`  ${order.id}: food ${formatMoney(order.itemTotal)} + delivery ${formatMoney(order.deliveryFee)} (1.5x surge) = ${formatMoney(order.total)}`);
service.accept(order.id, kitchen);
console.log(`  accepted, dispatched to ${order.partnerId} (nearest available); ETA ${service.estimateEtaMinutes(order.id)} min`);

console.log('\n--- Asha tries to start the cooking herself ---');
try {
  service.startPreparing(order.id, asha);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

service.startPreparing(order.id, kitchen);
clock.advanceMinutes(15);
service.markReady(order.id, kitchen);
service.pickUp(order.id, { role: ActorRole.PARTNER, id: 'P1' });
console.log(`\n--- Picked up; ETA now ${service.estimateEtaMinutes(order.id)} min, Ravi is ${ravi.status} ---`);
clock.advanceMinutes(15);
service.deliver(order.id, { role: ActorRole.PARTNER, id: 'P1' });
console.log(`  delivered; Ravi is ${ravi.status} at (${ravi.location.x}, ${ravi.location.y})`);

console.log('\n--- A second order is cancelled while cooking: the food is charged, delivery is not ---');
const second = service.placeOrder({ ...request, items: [{ itemId: 'biryani', quantity: 1 }] });
service.accept(second.id, kitchen);
service.startPreparing(second.id, kitchen);
const fee = service.cancel(second.id, asha);
console.log(`  ${second.id} via ${second.partnerId} cancelled, fee ${formatMoney(fee)}; Meera is ${meera.status}`);

console.log(`\nTimeline ${order.id}: ${observer.timeline(order.id).join(' -> ')}`);
