import { assertMoney, type Money } from '../shared/money';
import { VehicleNotAtStoreError, VehicleUnavailableError } from './errors';

export enum VehicleCategory {
  ECONOMY = 'ECONOMY',
  SUV = 'SUV',
  LUXURY = 'LUXURY',
}

export enum Transmission {
  MANUAL = 'MANUAL',
  AUTOMATIC = 'AUTOMATIC',
}

export interface VehicleProps {
  id: string;
  model: string;
  category: VehicleCategory;
  transmission: Transmission;
  /** Price per billable day in minor units. */
  dailyRate: Money;
  storeId: string;
}

/**
 * A physical car in the fleet. It knows where it is and whether its keys are
 * out, and refuses a second hand-over while an earlier rental is still open
 * (an overdue customer), which is the guard calendars alone cannot give.
 */
export class Vehicle {
  readonly id: string;
  readonly model: string;
  readonly category: VehicleCategory;
  readonly transmission: Transmission;
  readonly dailyRate: Money;
  private _storeId: string;
  private rentedUnder: string | null = null;

  constructor(props: VehicleProps) {
    assertMoney(props.dailyRate, 'dailyRate');
    this.id = props.id;
    this.model = props.model;
    this.category = props.category;
    this.transmission = props.transmission;
    this.dailyRate = props.dailyRate;
    this._storeId = props.storeId;
  }

  get storeId(): string {
    return this._storeId;
  }

  get isOnRent(): boolean {
    return this.rentedUnder !== null;
  }

  /** Keys handed over at the counter. Compare-and-set on `rentedUnder`. */
  checkOut(reservationId: string, pickupStoreId: string): void {
    if (this.rentedUnder !== null) {
      throw new VehicleUnavailableError(this.id, `still out on reservation ${this.rentedUnder}`);
    }
    if (this._storeId !== pickupStoreId) {
      throw new VehicleNotAtStoreError(this.id, pickupStoreId, this._storeId);
    }
    this.rentedUnder = reservationId;
  }

  /** Keys back. The car now lives where it was dropped off: that is how one-way rentals move the fleet. */
  checkIn(reservationId: string, returnStoreId: string): void {
    if (this.rentedUnder !== reservationId) {
      throw new RangeError(`Vehicle ${this.id} is not out on reservation ${reservationId}`);
    }
    this.rentedUnder = null;
    this._storeId = returnStoreId;
  }
}
