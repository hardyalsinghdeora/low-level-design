import type { Money } from '../../shared/money';
import type { ParkingTicket } from '../parking-ticket';
import type { VehicleType } from '../vehicle';

/** Strategy pattern: pricing policy is independent of the lot mechanics. */
export interface FeeStrategy {
  calculate(ticket: ParkingTicket, exitTime: Date): Money;
}

/** Charges per started hour with a rate per vehicle type. Rates are in minor units (paise). */
export class HourlyRateFeeStrategy implements FeeStrategy {
  constructor(
    private readonly ratePerHour: Record<VehicleType, Money>,
    private readonly minimumHours = 1,
  ) {}

  calculate(ticket: ParkingTicket, exitTime: Date): Money {
    const startedHours = Math.ceil(ticket.durationMinutes(exitTime) / 60);
    const billableHours = Math.max(this.minimumHours, startedHours);
    return billableHours * this.ratePerHour[ticket.vehicle.type];
  }
}

/** One price regardless of duration, e.g. event parking. */
export class FlatRateFeeStrategy implements FeeStrategy {
  constructor(private readonly amount: Money) {}

  calculate(): Money {
    return this.amount;
  }
}
