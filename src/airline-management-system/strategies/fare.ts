import { assertMoney, type Money } from '../../shared/money';
import type { SeatClass } from '../aircraft';
import type { FlightInstance } from '../flight';

/** Strategy: the price of one seat in a class on a departure, right now. */
export interface FareStrategy {
  fareFor(instance: FlightInstance, seatClass: SeatClass): Money;
}

/** Same base fare per class whatever the demand. */
export class FixedFareStrategy implements FareStrategy {
  constructor(private readonly baseFares: Record<SeatClass, Money>) {
    for (const fare of Object.values(baseFares)) assertMoney(fare, 'base fare');
  }

  fareFor(_instance: FlightInstance, seatClass: SeatClass): Money {
    return this.baseFares[seatClass];
  }
}

/**
 * Base fare per class plus a surge that grows linearly with the cabin's load
 * factor, up to `maxSurgeBps` when the cabin is full. Rounded half-up once.
 */
export class LoadFactorFareStrategy implements FareStrategy {
  constructor(
    private readonly baseFares: Record<SeatClass, Money>,
    private readonly maxSurgeBps: number,
  ) {
    for (const fare of Object.values(baseFares)) assertMoney(fare, 'base fare');
  }

  fareFor(instance: FlightInstance, seatClass: SeatClass): Money {
    const total = instance.aircraft.seatsIn(seatClass).length;
    const sold = total - instance.availableSeats(seatClass).length;
    const base = this.baseFares[seatClass];
    // Integer arithmetic: base * bps * sold / (total * 10_000), no float load factor in money.
    return base + (total === 0 ? 0 : Math.round((base * this.maxSurgeBps * sold) / (total * 10_000)));
  }
}
