import { Clock, SystemClock } from '../shared/clock';
import { IngredientCapacityExceededError, InsufficientIngredientError, type Shortage } from './errors';
import { amountEntries, Ingredient, type IngredientAmounts } from './ingredient';

export interface LowStockEvent {
  ingredient: Ingredient;
  remaining: number;
  threshold: number;
  at: Date;
}

/** Observer: maintenance panels, telemetry, a refill scheduler. */
export interface InventoryObserver {
  onLowStock(event: LowStockEvent): void;
}

export interface ContainerConfig {
  quantity: number;
  capacity: number;
  lowStockThreshold: number;
}

interface Container extends ContainerConfig {
  /** True once the low-stock alert fired; cleared by a refill above the threshold. */
  alerted: boolean;
}

/**
 * Ingredient containers. consume() is all-or-nothing, and a low-stock event
 * fires once per downward threshold crossing, not on every cup below it.
 */
export class IngredientInventory {
  private readonly containers = new Map<Ingredient, Container>();
  private readonly observers: InventoryObserver[] = [];
  private readonly clock: Clock;

  constructor(config: Partial<Record<Ingredient, ContainerConfig>>, options: { clock?: Clock } = {}) {
    this.clock = options.clock ?? new SystemClock();
    for (const ingredient of Object.values(Ingredient) as Ingredient[]) {
      const c = config[ingredient];
      if (!c) continue;
      if (c.quantity > c.capacity) throw new IngredientCapacityExceededError(ingredient, c.capacity);
      this.containers.set(ingredient, { ...c, alerted: c.quantity < c.lowStockThreshold });
    }
  }

  subscribe(observer: InventoryObserver): () => void {
    this.observers.push(observer);
    return () => {
      const i = this.observers.indexOf(observer);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  level(ingredient: Ingredient): number {
    return this.containers.get(ingredient)?.quantity ?? 0;
  }

  shortages(needed: Readonly<IngredientAmounts>): Shortage[] {
    return amountEntries(needed)
      .map(([ingredient, amount]) => ({ ingredient, needed: amount, available: this.level(ingredient) }))
      .filter((s) => s.available < s.needed);
  }

  canSupply(needed: Readonly<IngredientAmounts>): boolean {
    return this.shortages(needed).length === 0;
  }

  assertAvailable(needed: Readonly<IngredientAmounts>): void {
    const shortages = this.shortages(needed);
    if (shortages.length > 0) throw new InsufficientIngredientError(shortages);
  }

  /** Checks everything first, then subtracts: a short ingredient means nothing is consumed. */
  consume(needed: Readonly<IngredientAmounts>): void {
    this.assertAvailable(needed);
    const crossed: LowStockEvent[] = [];
    for (const [ingredient, amount] of amountEntries(needed)) {
      const c = this.containers.get(ingredient);
      if (!c) continue; // unreachable: assertAvailable saw a positive level
      c.quantity -= amount;
      if (!c.alerted && c.quantity < c.lowStockThreshold) {
        c.alerted = true;
        crossed.push({ ingredient, remaining: c.quantity, threshold: c.lowStockThreshold, at: this.clock.now() });
      }
    }
    for (const event of crossed) for (const o of this.observers) o.onLowStock(event);
  }

  refill(ingredient: Ingredient, amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`Invalid refill amount ${amount}`);
    const c = this.containers.get(ingredient);
    if (!c) throw new RangeError(`No container for ${ingredient}`);
    if (c.quantity + amount > c.capacity) throw new IngredientCapacityExceededError(ingredient, c.capacity);
    c.quantity += amount;
    if (c.quantity >= c.lowStockThreshold) c.alerted = false;
  }
}

/** A simple observer: what a maintenance screen would list. */
export class MaintenancePanel implements InventoryObserver {
  readonly alerts: LowStockEvent[] = [];

  onLowStock(event: LowStockEvent): void {
    this.alerts.push(event);
  }
}
