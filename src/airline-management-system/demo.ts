import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { Aircraft, Airline, AirlineSystem, Flight, LoadFactorFareStrategy, SeatClass } from './index';

const clock = new FakeClock('2026-07-01T08:00:00Z');
const system = new AirlineSystem({
  fareStrategy: new LoadFactorFareStrategy(
    { [SeatClass.ECONOMY]: 4_500_00, [SeatClass.BUSINESS]: 18_000_00, [SeatClass.FIRST]: 40_000_00 },
    5_000, // up to +50% when a cabin is full
  ),
  clock,
  ids: new SequentialIdGenerator(),
});

const skyway = new Airline('SW', 'Skyway Air');
const vt = Aircraft.withLayout('VT-SWA', 'A320neo', [
  [SeatClass.FIRST, 1, 'AB'],
  [SeatClass.BUSINESS, 1, 'ABCD'],
  [SeatClass.ECONOMY, 2, 'ABCD'],
]);
const sw101 = new Flight('SW101', skyway, 'DEL', 'BOM', 130);
system.schedule(sw101, vt, new Date('2026-07-05T03:30:00Z'));
system.schedule(sw101, vt, new Date('2026-07-05T13:00:00Z'));
system.schedule(sw101, vt, new Date('2026-07-06T03:30:00Z'));

console.log('\n--- Search DEL -> BOM on 2026-07-05 ---');
const results = system.search('DEL', 'BOM', '2026-07-05');
for (const r of results) {
  console.log(`  ${r.instance.id} ${r.instance.departureAt.toISOString()} economy ${formatMoney(r.fares.ECONOMY)} (${r.seatsLeft.ECONOMY} left)`);
}
const morning = results[0].instance;

console.log('\n--- The Kapoor family books four economy seats ---');
const kapoors = system.book(morning.id, [
  { passengerName: 'Raj Kapoor', seatNumber: '3A' },
  { passengerName: 'Simran Kapoor', seatNumber: '3B' },
  { passengerName: 'Aman Kapoor', seatNumber: '3C' },
  { passengerName: 'Tara Kapoor', seatNumber: '3D' },
]);
console.log(`  ${kapoors.pnr}: ${kapoors.tickets.map((t) => `${t.passenger.name} ${t.seat.number}`).join(', ')}`);
console.log(`  Total ${formatMoney(kapoors.total)}; economy now ${formatMoney(system.search('DEL', 'BOM', '2026-07-05')[0].fares.ECONOMY)} (load factor ${morning.loadFactor(SeatClass.ECONOMY)})`);

console.log('\n--- Nisha tries 3D and 4A together: 3D is taken, so neither is assigned ---');
try {
  system.book(morning.id, [
    { passengerName: 'Nisha', seatNumber: '4A' },
    { passengerName: 'Om', seatNumber: '3D' },
  ]);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}; 4A assigned? ${morning.isAssigned('4A')}`);
}
const nisha = system.book(morning.id, [{ passengerName: 'Nisha', seatNumber: '1A' }]);
console.log(`  Nisha upgrades to First: ${nisha.pnr} ${formatMoney(nisha.total)}`);

console.log('\n--- Check-in opens 48h before departure ---');
try {
  system.checkIn(kapoors.pnr);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
clock.set('2026-07-03T10:00:00Z');
console.log(`  ${system.checkIn(kapoors.pnr).pnr} is ${kapoors.status}`);

console.log('\n--- Nisha cancels 41.5h before departure (50% fee tier) ---');
const result = system.cancel(nisha.pnr);
console.log(`  Fee ${formatMoney(result.fee)}, refund ${formatMoney(result.refund)}; 1A free again: ${!morning.isAssigned('1A')}`);
