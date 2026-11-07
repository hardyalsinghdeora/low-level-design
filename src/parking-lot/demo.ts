import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import {
  BestFitStrategy,
  Car,
  HourlyRateFeeStrategy,
  Motorcycle,
  ParkingFloor,
  ParkingLot,
  ParkingSpot,
  SpotSize,
  Truck,
  VehicleType,
} from './index';

const clock = new FakeClock('2026-03-01T09:00:00Z');

const lot = new ParkingLot('Phoenix Mall Parking', {
  feeStrategy: new HourlyRateFeeStrategy({
    [VehicleType.MOTORCYCLE]: 2_000, // Rs 20 / hour in paise
    [VehicleType.CAR]: 5_000,
    [VehicleType.TRUCK]: 10_000,
  }),
  assignmentStrategy: new BestFitStrategy(),
  clock,
  ids: new SequentialIdGenerator(),
});

lot
  .addFloor(
    new ParkingFloor(1)
      .addSpot(new ParkingSpot('F1-S1', SpotSize.SMALL, 1, 5))
      .addSpot(new ParkingSpot('F1-M1', SpotSize.MEDIUM, 1, 10))
      .addSpot(new ParkingSpot('F1-L1', SpotSize.LARGE, 1, 20)),
  )
  .addFloor(
    new ParkingFloor(2)
      .addSpot(new ParkingSpot('F2-M1', SpotSize.MEDIUM, 2, 10))
      .addSpot(new ParkingSpot('F2-M2', SpotSize.MEDIUM, 2, 12)),
  );

function printBoard(): void {
  for (const floor of lot.availability()) {
    console.log(
      `  Floor ${floor.floor}: ${floor.totalAvailable}/${floor.totalSpots} free ` +
        `(S:${floor.available.SMALL} M:${floor.available.MEDIUM} L:${floor.available.LARGE})`,
    );
  }
}

console.log(`\n${lot.name} - opening at ${clock.now().toISOString()}`);
printBoard();

console.log('\n--- Vehicles arrive ---');
const bike = lot.park(new Motorcycle('KA-01-AB-1111'));
const car = lot.park(new Car('KA-01-CD-2222'));
const truck = lot.park(new Truck('KA-01-EF-3333'));
for (const t of [bike, car, truck]) console.log(`  ${t.vehicle.licensePlate} -> ${t.spot.id} (${t.id})`);
printBoard();

console.log('\n--- Second car goes to floor 2 (best fit keeps the LARGE spot free) ---');
const car2 = lot.park(new Car('KA-01-GH-4444'));
console.log(`  ${car2.vehicle.licensePlate} -> ${car2.spot.id}`);

console.log('\n--- A second truck finds no spot ---');
try {
  lot.park(new Truck('KA-01-IJ-5555'));
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- 2h35m later the car leaves (rounded up to 3 billable hours) ---');
clock.advanceMinutes(155);
const receipt = lot.unpark(car.id);
console.log(`  ${receipt.licensePlate} left ${receipt.spotId} after ${receipt.durationMinutes} min, fee ${formatMoney(receipt.fee)}`);
printBoard();

console.log('\n--- Bike leaves after 10 min, still charged the 1 hour minimum ---');
clock.advanceMinutes(10);
const bikeReceipt = lot.unpark(bike.id);
console.log(`  ${bikeReceipt.licensePlate} fee ${formatMoney(bikeReceipt.fee)}`);
console.log(`\nActive tickets: ${lot.activeTicketCount}`);
