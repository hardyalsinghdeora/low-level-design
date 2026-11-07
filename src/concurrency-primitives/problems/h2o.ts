import { Barrier } from '../latch';
import { Semaphore } from '../semaphore';

/**
 * LeetCode 1117. Hydrogen and oxygen workers arrive in any order; every
 * consecutive group of three releases must be exactly two H and one O.
 * The semaphores admit at most two H and one O into the current molecule and
 * the barrier makes all three wait for each other. A slot is only returned
 * after its atom is released, so the next molecule cannot form until this
 * one has been printed.
 */
export class H2O {
  private readonly hydrogenSlots = new Semaphore(2);
  private readonly oxygenSlots = new Semaphore(1);
  private readonly bond = new Barrier(3);

  async hydrogen(releaseHydrogen: () => void): Promise<void> {
    await this.hydrogenSlots.acquire();
    await this.bond.arrive();
    releaseHydrogen();
    this.hydrogenSlots.release();
  }

  async oxygen(releaseOxygen: () => void): Promise<void> {
    await this.oxygenSlots.acquire();
    await this.bond.arrive();
    releaseOxygen();
    this.oxygenSlots.release();
  }
}
