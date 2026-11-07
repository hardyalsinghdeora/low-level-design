import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { DemandBasedSurge, Driver, Party, RideSharingService, Rider, StandardFare, TripTimeline } from './index';

const clock = new FakeClock('2026-08-01T08:00:00Z');
const timeline = new TripTimeline();
const service = new RideSharingService({
  fare: new StandardFare({ base: 5_000, perKm: 1_200, perMinute: 200, minimum: 8_000 }),
  surge: new DemandBasedSurge(200),
  clock,
  ids: new SequentialIdGenerator(),
});
service.subscribe(timeline);

const arun = new Driver('D1', 'Arun', { x: 1, y: 0 }, 'KA-01-1111');
const bhavna = new Driver('D2', 'Bhavna', { x: 2.5, y: 0 }, 'KA-01-2222');
service.addDriver(arun).addDriver(bhavna);
for (const [id, name] of [['priya', 'Priya'], ['rahul', 'Rahul'], ['sam', 'Sam']]) service.addRider(new Rider(id, name, { x: 0, y: 0 }));
arun.goOnline();
bhavna.goOnline();
const status = () => `Arun ${arun.status}, Bhavna ${bhavna.status}`;

console.log('\n--- 08:00 Priya requests a 10 km ride ---');
const trip = service.requestTrip('priya', { x: 0, y: 0 }, { x: 6, y: 8 });
console.log(`  ${trip.id} ${trip.status} by ${trip.driverId}, surge ${trip.surgePercent}%; ${status()}`);

console.log('\n--- Rahul requests too and gets the last online driver ---');
const second = service.requestTrip('rahul', { x: 0, y: 0 }, { x: 3, y: 4 });
console.log(`  ${second.id} ${second.status} by ${second.driverId}, surge ${second.surgePercent}%`);

console.log('\n--- Sam requests with nobody online: surge hits the cap and there is no match ---');
const third = service.requestTrip('sam', { x: 0, y: 0 }, { x: 1, y: 1 });
console.log(`  ${third.id} ${third.status}, surge ${third.surgePercent}% locked for Sam`);
try {
  service.retryMatch(third.id);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message} (trip stays ${third.status})`);
}

console.log('\n--- Rahul cancels 3 minutes after Bhavna accepted (grace is 2 minutes) ---');
clock.advanceMinutes(3);
const fee = service.cancelTrip(second.id, Party.RIDER);
console.log(`  cancellation fee ${formatMoney(fee)}; ${status()}`);
const matched = service.retryMatch(third.id);
console.log(`  Sam's ${third.id} now ${third.status} by ${matched.name}`);

console.log('\n--- Priya rides for 25 minutes ---');
service.startTrip(trip.id, 'D1');
clock.advanceMinutes(25);
service.completeTrip(trip.id, 'D1');
const fare = trip.fare;
if (fare) {
  console.log(`  base ${formatMoney(fare.base)} + distance ${formatMoney(fare.distanceCharge)} + time ${formatMoney(fare.timeCharge)}`);
  console.log(`  x ${fare.surgePercent}% surge = ${formatMoney(fare.total)}`);
}
console.log(`  ${status()}; Arun is now at (${arun.location.x}, ${arun.location.y})`);

console.log('\n--- Ratings both ways ---');
service.rateDriver(trip.id, 5);
service.rateRider(trip.id, 4);
try {
  service.rateDriver(trip.id, 1);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
console.log(`  Arun ${arun.ratings.average} (${arun.ratings.count}), Priya ${service.rider('priya').ratings.average}`);
console.log(`\nTimeline ${trip.id}: ${timeline.of(trip.id).join(' -> ')}`);
