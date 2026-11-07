import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { FreeUntilDaysBeforePolicy, Hotel, Room, RoomType, SeasonalPricing } from './index';

const clock = new FakeClock('2026-03-02T10:00:00Z'); // a Monday

const deluxe = new RoomType('DELUXE', 'Deluxe King', 8_000_00, 2);
const suite = new RoomType('SUITE', 'Lake Suite', 15_000_00, 4);

const hotel = new Hotel('Lakeview Udaipur', {
  pricing: new SeasonalPricing(2_000, [{ from: '2026-03-13', until: '2026-03-16', surchargeBps: 5_000 }]),
  cancellationPolicy: new FreeUntilDaysBeforePolicy(3),
  taxBps: 1_200,
  clock,
  ids: new SequentialIdGenerator(),
});
hotel.addRoomType(deluxe).addRoomType(suite);
hotel.addRoom(new Room('101', deluxe, 1)).addRoom(new Room('102', deluxe, 1)).addRoom(new Room('501', suite, 5));

console.log(`\n${hotel.name} - today is ${clock.now().toISOString().slice(0, 10)}`);
const asha = hotel.registerGuest('Asha Rao', 'asha@example.com');
const vikram = hotel.registerGuest('Vikram Shah', 'vikram@example.com');
const meera = hotel.registerGuest('Meera Iyer', 'meera@example.com');

console.log('\n--- Quotes for Thu 5 Mar -> Mon 9 Mar (Fri and Sat nights carry +20%) ---');
console.log(`  Deluxe: ${formatMoney(hotel.quote('DELUXE', '2026-03-05', '2026-03-09'))}`);
console.log(`  Suite:  ${formatMoney(hotel.quote('SUITE', '2026-03-05', '2026-03-09'))}`);

console.log('\n--- Asha books the only suite ---');
const ashaStay = hotel.book(asha.id, 'SUITE', '2026-03-05', '2026-03-09');
console.log(`  ${ashaStay.id}: room ${ashaStay.room.number}, ${ashaStay.dates}, ${formatMoney(ashaStay.roomTotal)}`);

console.log('\n--- Vikram wants the suite for overlapping dates ---');
try {
  hotel.book(vikram.id, 'SUITE', '2026-03-08', '2026-03-10');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  const retry = hotel.book(vikram.id, 'SUITE', '2026-03-09', '2026-03-11');
  console.log(`  Retried from Asha's check-out day: ${retry.id} ${retry.dates} (half-open ranges, no clash)`);
}

console.log('\n--- Meera books a festival weekend deluxe, (cancels later) ---');
const meeraStay = hotel.book(meera.id, 'DELUXE', '2026-03-13', '2026-03-15');
console.log(`  ${meeraStay.id}: ${meeraStay.nightlyCharges.map((n) => `${n.date} ${formatMoney(n.amount)}`).join(', ')}`);

console.log('\n--- Asha arrives, raids the minibar, checks out ---');
clock.set('2026-03-05T14:00:00Z');
hotel.checkIn(ashaStay.id);
hotel.addExtra(ashaStay.id, 'Minibar', 1_850_00);
hotel.addExtra(ashaStay.id, 'Airport transfer', 2_500_00);
clock.set('2026-03-09T11:00:00Z');
const invoice = hotel.checkOut(ashaStay.id);
for (const line of invoice.lines) console.log(`  ${line.description.padEnd(28)} ${formatMoney(line.amount)}`);
console.log(`  Subtotal ${formatMoney(invoice.subtotal)} + tax ${formatMoney(invoice.tax)} = ${formatMoney(invoice.total)}`);
console.log(`  Reservation status: ${ashaStay.status}`);

console.log('\n--- On 11 Mar Meera cancels, 2 days ahead (free window is 3) ---');
clock.set('2026-03-11T18:00:00Z');
const cancellation = hotel.cancel(meeraStay.id);
console.log(`  Fee: first night ${formatMoney(cancellation.fee)}`);
