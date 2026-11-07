import { Semaphore } from '../semaphore';

/**
 * LeetCode 1116. Three workers print 0 1 0 2 0 3 ... 0 n. The zero worker
 * owns the turn and hands it to the odd or even worker, who hands it back.
 */
export class ZeroEvenOdd {
  private readonly zeroTurn = new Semaphore(1, 1);
  private readonly oddTurn = new Semaphore(0, 1);
  private readonly evenTurn = new Semaphore(0, 1);

  constructor(readonly n: number) {}

  async zero(print: (value: number) => void): Promise<void> {
    for (let i = 1; i <= this.n; i += 1) {
      await this.zeroTurn.acquire();
      print(0);
      (i % 2 === 1 ? this.oddTurn : this.evenTurn).release();
    }
  }

  async odd(print: (value: number) => void): Promise<void> {
    for (let i = 1; i <= this.n; i += 2) {
      await this.oddTurn.acquire();
      print(i);
      this.zeroTurn.release();
    }
  }

  async even(print: (value: number) => void): Promise<void> {
    for (let i = 2; i <= this.n; i += 2) {
      await this.evenTurn.acquire();
      print(i);
      this.zeroTurn.release();
    }
  }
}
