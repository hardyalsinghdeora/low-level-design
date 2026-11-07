import { assertMoney, type Money } from '../shared/money';
import { MenuItemNotFoundError } from './errors';

export enum MenuCategory {
  STARTER = 'STARTER',
  MAIN = 'MAIN',
  DESSERT = 'DESSERT',
  DRINK = 'DRINK',
}

/** Where in the kitchen an item is made; each station has its own ticket queue. */
export enum Station {
  GRILL = 'GRILL',
  FRY = 'FRY',
  BAR = 'BAR',
}

/** A dish as the guest sees it, plus what the kitchen needs: station and preparation time. */
export class MenuItem {
  private _available = true;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly category: MenuCategory,
    readonly price: Money,
    readonly station: Station,
    readonly prepMinutes: number,
  ) {
    assertMoney(price, 'price');
    if (!Number.isInteger(prepMinutes) || prepMinutes < 1) throw new RangeError(`prepMinutes must be a positive integer`);
  }

  get isAvailable(): boolean {
    return this._available;
  }

  /** "86 the paneer": the item stays on the menu but cannot be ordered. */
  setAvailable(available: boolean): void {
    this._available = available;
  }
}

/** The catalog of dishes, grouped by category for the menu card. */
export class Menu {
  private readonly items = new Map<string, MenuItem>();

  add(item: MenuItem): this {
    if (this.items.has(item.id)) throw new RangeError(`Duplicate menu item ${item.id}`);
    this.items.set(item.id, item);
    return this;
  }

  get(itemId: string): MenuItem {
    const item = this.items.get(itemId);
    if (!item) throw new MenuItemNotFoundError(itemId);
    return item;
  }

  setAvailability(itemId: string, available: boolean): void {
    this.get(itemId).setAvailable(available);
  }

  byCategory(category: MenuCategory, onlyAvailable = true): MenuItem[] {
    return [...this.items.values()].filter((i) => i.category === category && (!onlyAvailable || i.isAvailable));
  }
}
