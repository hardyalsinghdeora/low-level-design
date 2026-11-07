import { Semaphore } from '../semaphore';

/**
 * LeetCode 1115. Two workers share one instance; `foo()` and `bar()` must
 * print "foobar" n times. Two one-permit semaphores pass the turn back and
 * forth like a baton.
 */
export class FooBar {
  private readonly fooTurn = new Semaphore(1, 1);
  private readonly barTurn = new Semaphore(0, 1);

  constructor(readonly n: number) {}

  async foo(printFoo: () => void): Promise<void> {
    for (let i = 0; i < this.n; i += 1) {
      await this.fooTurn.acquire();
      printFoo();
      this.barTurn.release();
    }
  }

  async bar(printBar: () => void): Promise<void> {
    for (let i = 0; i < this.n; i += 1) {
      await this.barTurn.acquire();
      printBar();
      this.fooTurn.release();
    }
  }
}
