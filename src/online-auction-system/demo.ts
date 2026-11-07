import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { AuctionHouse, InMemoryNotifier, SoftCloseWindow, TieredIncrement } from './index';

const clock = new FakeClock('2026-05-01T10:00:00Z');
const notifier = new InMemoryNotifier();
const house = new AuctionHouse({
  clock,
  ids: new SequentialIdGenerator(),
  // Rs 50 steps below Rs 1,000, Rs 100 steps up to Rs 5,000, Rs 500 above (in paise)
  increments: new TieredIncrement([
    { from: 0, increment: 5_000 },
    { from: 100_000, increment: 10_000 },
    { from: 500_000, increment: 50_000 },
  ]),
  softClose: new SoftCloseWindow(5),
});
house.subscribe(notifier);

const camera = house.createAuction({
  sellerId: 'sana',
  title: 'Leica M6 film camera',
  startingPrice: 100_000,
  reservePrice: 300_000,
  startAt: clock.now(),
  endAt: new Date('2026-05-01T12:00:00Z'),
});
const show = (label: string) =>
  console.log(`  ${label.padEnd(34)} leader=${camera.leaderId ?? '-'} price=${formatMoney(camera.currentPrice)} ends=${camera.endAt.toISOString().slice(11, 16)}`);

console.log(`\n${camera.title} (${camera.id}) is ${camera.status}, reserve ${formatMoney(camera.reservePrice)}`);

console.log('\n--- Proxy bids: each bidder states a maximum, the system bids for them ---');
house.placeBid(camera.id, 'arjun', 250_000);
show('arjun max Rs 2,500');
house.placeBid(camera.id, 'bela', 200_000);
show('bela max Rs 2,000 (proxy answers)');
house.placeBid(camera.id, 'chen', 400_000);
show('chen max Rs 4,000 (jumps to reserve)');

console.log('\n--- The seller tries to bid up their own lot ---');
try {
  house.placeBid(camera.id, 'sana', 450_000);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- A late bid at 11:58 lands in the soft-close window ---');
clock.set('2026-05-01T11:58:00Z');
house.placeBid(camera.id, 'arjun', 600_000);
show('arjun raises to Rs 6,000');

console.log('\n--- 12:00 passes; the lot is still open until 12:03 ---');
clock.set('2026-05-01T12:03:00Z');
const closed = house.closeExpired();
console.log(`  closed: ${closed.map((a) => a.id).join(', ')}, result: ${JSON.stringify(camera.result)}`);

console.log('\n--- A bid after the end is rejected ---');
try {
  house.placeBid(camera.id, 'bela', 900_000);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- Inboxes (Observer) ---');
for (const user of ['arjun', 'bela', 'chen', 'sana']) {
  console.log(`  ${user}:`);
  for (const message of notifier.inbox(user)) console.log(`    - ${message}`);
}
