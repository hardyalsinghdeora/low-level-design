import { assertMoney, type Money } from '../shared/money';
import { MenuItemUnavailableError } from './errors';
import type { Location } from './geo';

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly price: Money;
  available: boolean;
}

export interface OpeningWindow {
  /** "HH:MM" in UTC. A window whose close is before its open runs past midnight. */
  readonly open: string;
  readonly close: string;
}

/** Daily opening hours. Kept as a value object so "is it open now" is one pure function of the clock. */
export class OpeningHours {
  private readonly windows: { open: number; close: number }[];

  constructor(windows: OpeningWindow[]) {
    this.windows = windows.map((w) => ({ open: toMinutes(w.open), close: toMinutes(w.close) }));
  }

  isOpenAt(at: Date): boolean {
    const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
    return this.windows.some(({ open, close }) =>
      open <= close ? minute >= open && minute < close : minute >= open || minute < close,
    );
  }
}

function toMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new RangeError(`time must be HH:MM, got ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** A restaurant with its menu, location, hours and typical preparation time. */
export class Restaurant {
  private readonly menu = new Map<string, MenuItem>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly location: Location,
    readonly hours: OpeningHours,
    readonly prepMinutes = 15,
  ) {}

  addItem(id: string, name: string, price: Money): this {
    assertMoney(price, 'price');
    this.menu.set(id, { id, name, price, available: true });
    return this;
  }

  setAvailability(itemId: string, available: boolean): void {
    this.item(itemId).available = available;
  }

  isOpenAt(at: Date): boolean {
    return this.hours.isOpenAt(at);
  }

  /** Returns an orderable item or throws; sold-out items count as unavailable. */
  orderable(itemId: string): MenuItem {
    const item = this.item(itemId);
    if (!item.available) throw new MenuItemUnavailableError(this.id, itemId);
    return item;
  }

  private item(itemId: string): MenuItem {
    const item = this.menu.get(itemId);
    if (!item) throw new MenuItemUnavailableError(this.id, itemId);
    return item;
  }
}
