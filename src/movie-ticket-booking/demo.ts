import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { BookingService, Cinema, City, FakePaymentGateway, InMemoryNotifier, Movie, Screen, Seat, SeatType, Show } from './index';

const clock = new FakeClock('2026-05-10T09:00:00Z');
const ids = new SequentialIdGenerator();
const rolls = [0.9, 0.05, 0.9]; // gateway declines when roll < 0.1: the second charge fails
const gateway = new FakePaymentGateway({ failureRate: 0.1, rng: () => rolls.shift() ?? 0.9, ids });
const notifier = new InMemoryNotifier();
const service = new BookingService({ payment: gateway, lockTtlSeconds: 300, clock, ids });
service.subscribe(notifier);

const bengaluru = new City('BLR', 'Bengaluru');
const audi = new Screen('AUDI-1', 'Audi 1', [
  ...['A1', 'A2', 'A3', 'A4'].map((id) => new Seat(id, 'A', SeatType.REGULAR)),
  ...['R1', 'R2'].map((id) => new Seat(id, 'R', SeatType.RECLINER)),
]);
const cinema = new Cinema('ORION', 'Orion Multiplex', bengaluru, [audi]);
const movie = new Movie('MOV-1', 'The Long Monsoon', 150);
service.addShow(
  new Show('SHOW-1', movie, cinema, audi, new Date('2026-05-10T15:00:00Z'), {
    [SeatType.REGULAR]: 250_00,
    [SeatType.PREMIUM]: 350_00,
    [SeatType.RECLINER]: 600_00,
  }),
);

const [show] = service.findShows('Bengaluru', 'The Long Monsoon');
const board = () => audi.seats.map((s) => `${s.id}:${service.seatStatus(show.id, s.id)[0]}`).join(' ');
console.log(`\n${movie.title} at ${cinema.name}, ${show.startsAt.toISOString()}`);
console.log(`  ${board()}`);

console.log('\n--- Riya locks A1+A2; Kabir wants A2+A3 at the same moment ---');
const riya = service.holdSeats('riya', show.id, ['A1', 'A2']);
try {
  service.holdSeats('kabir', show.id, ['A2', 'A3']);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message} (A3 stays free: all-or-nothing)`);
}
console.log(`  ${board()}`);

console.log('\n--- Riya pays within the TTL ---');
service.confirm(riya.id, 'riya');
console.log(`  ${riya.id} ${riya.status}, paid ${formatMoney(riya.amount)} -> ${notifier.messages.at(-1)}`);

console.log('\n--- Kabir locks the recliners but his card is declined ---');
const kabir = service.holdSeats('kabir', show.id, ['R1', 'R2']);
try {
  service.confirm(kabir.id, 'kabir');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}; booking ${kabir.status}`);
}
console.log(`  ${board()} (locks released)`);

console.log('\n--- Kabir locks R1 again, gets distracted for 6 minutes ---');
const kabir2 = service.holdSeats('kabir', show.id, ['R1']);
clock.advanceMinutes(6);
console.log(`  R1 is now ${service.seatStatus(show.id, 'R1')} (lazy expiry)`);
try {
  service.confirm(kabir2.id, 'kabir');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}; charges so far: ${gateway.chargeCount}`);
}

console.log('\n--- Riya cancels 3h before the show: 50% refund ---');
clock.set('2026-05-10T12:00:00Z');
console.log(`  Refund ${formatMoney(service.cancel(riya.id, 'riya'))}; ${board()}`);
