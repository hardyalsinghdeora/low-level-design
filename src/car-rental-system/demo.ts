import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  CarRentalSystem,
  DateRange,
  type Invoice,
  MaxDailyRateSpec,
  RentalExtra,
  StandardPricingStrategy,
  Store,
  StoreSpec,
  Transmission,
  TransmissionSpec,
  Vehicle,
  VehicleCategory,
  VehicleUnavailableError,
} from './index';

const clock = new FakeClock('2026-03-02T09:00:00Z');
const system = new CarRentalSystem({
  pricing: new StandardPricingStrategy({
    extraDailyRates: { [RentalExtra.INSURANCE]: 50_000, [RentalExtra.CHILD_SEAT]: 20_000 }, // Rs 500 / Rs 200 a day
    lateFeePerHour: 30_000,
    oneWayFee: 150_000,
  }),
  clock,
  ids: new SequentialIdGenerator(),
});

system.addStore(new Store('BLR-AIR', 'Bengaluru Airport', 'Bengaluru')).addStore(new Store('MYS', 'Mysuru Central', 'Mysuru'));
const { ECONOMY, SUV, LUXURY } = VehicleCategory;
const { MANUAL, AUTOMATIC } = Transmission;
system
  .addVehicle(new Vehicle({ id: 'ECO-1', model: 'Swift', category: ECONOMY, transmission: MANUAL, dailyRate: 180_000, storeId: 'BLR-AIR' }))
  .addVehicle(new Vehicle({ id: 'ECO-2', model: 'Baleno', category: ECONOMY, transmission: AUTOMATIC, dailyRate: 220_000, storeId: 'BLR-AIR' }))
  .addVehicle(new Vehicle({ id: 'SUV-1', model: 'Creta', category: SUV, transmission: AUTOMATIC, dailyRate: 350_000, storeId: 'BLR-AIR' }))
  .addVehicle(new Vehicle({ id: 'LUX-1', model: 'BMW 5', category: LUXURY, transmission: AUTOMATIC, dailyRate: 1_200_000, storeId: 'BLR-AIR' }));

function printInvoice(title: string, invoice: Invoice): void {
  console.log(`  ${title}`);
  for (const line of invoice.lines) console.log(`    ${line.description.padEnd(36)} ${formatMoney(line.amount)}`);
  console.log(`    ${'Total'.padEnd(36)} ${formatMoney(invoice.total)}`);
}

const weekend = new DateRange('2026-03-06T10:00:00Z', '2026-03-09T10:00:00Z'); // Fri 10:00 -> Mon 10:00
const filter = new TransmissionSpec(AUTOMATIC).and(new StoreSpec('BLR-AIR')).and(new MaxDailyRateSpec(400_000));

console.log('\n--- Search: automatic, at the airport, up to Rs 4,000/day, Fri-Mon ---');
for (const v of system.search(weekend, filter)) console.log(`  ${v.id} ${v.model} (${v.category}) ${formatMoney(v.dailyRate)}/day`);

console.log('\n--- Asha books the Creta one-way to Mysuru, with insurance ---');
const asha = system.reserve({ customerId: 'asha', vehicleId: 'SUV-1', period: weekend, returnStoreId: 'MYS', extras: [RentalExtra.INSURANCE] });
printInvoice(`${asha.id} estimate`, asha.estimate);

console.log('\n--- Ravi wants the same Creta from Sunday to Tuesday ---');
const sundayToTuesday = new DateRange('2026-03-08T10:00:00Z', '2026-03-10T10:00:00Z');
try {
  system.reserve({ customerId: 'ravi', vehicleId: 'SUV-1', period: sundayToTuesday });
} catch (error) {
  if (!(error instanceof VehicleUnavailableError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
  const [alternative] = system.search(sundayToTuesday, filter);
  const ravi = system.reserve({ customerId: 'ravi', vehicleId: alternative.id, period: sundayToTuesday });
  console.log(`  Offered the ${alternative.model} instead -> ${ravi.id} ${ravi.status}`);
}

console.log('\n--- Friday pickup, Monday return in Mysuru 2h40m late ---');
clock.set('2026-03-06T10:20:00Z');
system.pickUp(asha.id);
console.log(`  ${asha.id} ${asha.status} at ${clock.now().toISOString()}`);
clock.set('2026-03-09T12:40:00Z');
printInvoice(`${asha.id} final invoice`, system.returnVehicle(asha.id));
console.log(`  ${asha.id} ${asha.status}; the Creta now lives at ${asha.vehicle.storeId}`);
const nextWeek = new DateRange('2026-03-16T10:00:00Z', '2026-03-17T10:00:00Z');
console.log(`  Bookable in Mysuru next week: ${system.search(nextWeek, new StoreSpec('MYS')).map((v) => v.model).join(', ')}`);
