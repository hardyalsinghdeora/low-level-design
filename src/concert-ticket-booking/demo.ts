import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  ConcertEvent,
  GeneralAdmissionCategory,
  ReservedSeatingCategory,
  TicketingService,
  TicketTier,
  type Offer,
} from './index';

const clock = new FakeClock('2026-09-01T10:00:00Z');
const ticketing = new TicketingService({ offerTtlMinutes: 30, clock, ids: new SequentialIdGenerator() });
const offers: Offer[] = [];
ticketing.onOffer({ onOfferMade: (offer) => offers.push(offer) });

const event = new ConcertEvent(
  'EVT-1',
  'Midnight Raga Live',
  'Jawaharlal Nehru Stadium',
  new Date('2026-10-20T19:00:00Z'),
  [
    new ReservedSeatingCategory(TicketTier.VIP, 12_000_00, ['V1', 'V2', 'V3']),
    new GeneralAdmissionCategory(TicketTier.PREMIUM, 5_000_00, 2),
    new GeneralAdmissionCategory(TicketTier.GENERAL, 1_500_00, 4),
  ],
  4,
);
ticketing.addEvent(event);
ticketing.openSales(event.id);
const stock = () => event.categories.map((c) => `${c.tier}:${c.available}`).join(' ') + ` [${event.status}]`;
console.log(`\n${event.name} @ ${event.venue} - ${stock()}`);

console.log('\n--- Anil buys 2 VIP seats and 2 General in one order ---');
const anil = ticketing.placeOrder('anil', event.id, [
  { tier: TicketTier.VIP, quantity: 2, seatIds: ['V1', 'V2'] },
  { tier: TicketTier.GENERAL, quantity: 2 },
]);
console.log(`  ${anil.id}: ${anil.ticketCount} tickets, ${formatMoney(anil.total)} - ${stock()}`);

console.log('\n--- Bela wants V2 plus 1 Premium: V2 is gone, so nothing is booked ---');
try {
  ticketing.placeOrder('bela', event.id, [
    { tier: TicketTier.PREMIUM, quantity: 1 },
    { tier: TicketTier.VIP, quantity: 1, seatIds: ['V2'] },
  ]);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message} - ${stock()}`);
}

console.log('\n--- The rest sells out; Chirag and Dev join the Premium waitlist ---');
const bela = ticketing.placeOrder('bela', event.id, [
  { tier: TicketTier.PREMIUM, quantity: 2 },
  { tier: TicketTier.VIP, quantity: 1 },
]);
ticketing.placeOrder('esha', event.id, [{ tier: TicketTier.GENERAL, quantity: 2 }]);
console.log(`  ${stock()}`);
ticketing.joinWaitlist('chirag', event.id, TicketTier.PREMIUM, 2);
ticketing.joinWaitlist('dev', event.id, TicketTier.PREMIUM, 1);
console.log(`  Premium waitlist: ${ticketing.waitlistFor(event.id, TicketTier.PREMIUM).map((e) => e.userId).join(', ')}`);

console.log('\n--- Bela cancels 49 days out (full refund); the freed stock goes to the waitlist ---');
const refund = ticketing.cancelOrder(bela.id, 'bela');
const offerList = offers.map((o) => `${o.userId} x${o.allocation.quantity} ${o.allocation.tier}`).join(', ');
console.log(`  Refund ${formatMoney(refund)}; offers made: ${offerList}`);
console.log(`  ${stock()} (Premium is held for Chirag, VIP is back on sale)`);

console.log('\n--- Chirag sleeps through the 30 minute offer; it passes to Dev ---');
clock.advanceMinutes(31);
console.log(`  Expired offers: ${ticketing.tick()}; latest offer -> ${offers.at(-1)?.userId}`);
const devOrder = ticketing.acceptOffer(offers.at(-1)?.id ?? '', 'dev');
console.log(`  Dev accepted: ${devOrder.id} ${formatMoney(devOrder.total)} - ${stock()}`);
