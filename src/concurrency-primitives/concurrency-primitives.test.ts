import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  Barrier, BoundedBlockingQueue, CountDownLatch, FooBar, H2O, Mutex, NotLockedError, PermitOverflowError, ReadWriteLock,
  Semaphore, ZeroEvenOdd,
} from './index';

/** Deterministic PRNG (mulberry32) so "random" interleavings are reproducible. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function yieldRandomly(rng: () => number): Promise<void> {
  const turns = Math.floor(rng() * 3);
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

describe('Mutex', () => {
  it('prevents the lost update that happens between awaits', async () => {
    let counter = 0;
    const increment = async () => {
      const read = counter;
      await Promise.resolve();
      counter = read + 1;
    };
    await Promise.all(Array.from({ length: 10 }, increment));
    expect(counter).toBe(1); // the race, reproduced

    counter = 0;
    const mutex = new Mutex();
    await Promise.all(Array.from({ length: 10 }, () => mutex.withLock(increment)));
    expect(counter).toBe(10);
    expect(mutex.isLocked).toBe(false);
  });

  it('serves waiters in FIFO order and tryAcquire never barges', async () => {
    const mutex = new Mutex();
    await mutex.acquire();
    const order: number[] = [];
    const waiters = [1, 2, 3].map((n) => mutex.acquire().then(() => order.push(n)).then(() => mutex.release()));
    expect(mutex.tryAcquire()).toBe(false);
    expect(mutex.waiting).toBe(3);
    mutex.release();
    await Promise.all(waiters);
    expect(order).toEqual([1, 2, 3]);
    expect(mutex.tryAcquire()).toBe(true);
  });

  it('releases on a thrown error and rejects releasing an unlocked mutex', async () => {
    const mutex = new Mutex();
    await expect(mutex.withLock(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(mutex.isLocked).toBe(false);
    expect(() => mutex.release()).toThrow(NotLockedError);
  });
});

describe('Semaphore', () => {
  it('never lets more than n tasks into the section', async () => {
    const rng = seeded(7);
    const semaphore = new Semaphore(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        semaphore.withPermit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await yieldRandomly(rng);
          await nextTurn();
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(semaphore.available).toBe(3);
  });

  it('tryAcquire fails when exhausted and over-release throws', () => {
    const semaphore = new Semaphore(1);
    expect(semaphore.tryAcquire()).toBe(true);
    expect(semaphore.tryAcquire()).toBe(false);
    semaphore.release();
    expect(() => semaphore.release()).toThrow(PermitOverflowError);
  });
});

describe('BoundedBlockingQueue', () => {
  it('blocks put when full and take when empty (backpressure)', async () => {
    const queue = new BoundedBlockingQueue<number>(2);
    await queue.put(1);
    await queue.put(2);
    let putDone = false;
    const pending = queue.put(3).then(() => (putDone = true));
    await nextTurn();
    expect(putDone).toBe(false);
    expect(queue.offer(4)).toBe(false);
    expect(await queue.take()).toBe(1);
    await pending;
    expect(putDone).toBe(true);
    expect([await queue.take(), await queue.take()]).toEqual([2, 3]);

    let taken: number | undefined;
    const waiting = queue.take().then((v) => (taken = v));
    await nextTurn();
    expect(taken).toBeUndefined();
    expect(queue.poll()).toBeUndefined();
    await queue.put(9);
    await waiting;
    expect(taken).toBe(9);
  });

  it('several producers and consumers: every item once, per-producer order kept, capacity never exceeded', async () => {
    const rng = seeded(42);
    const queue = new BoundedBlockingQueue<string>(3);
    const consumed: string[][] = [[], []];
    let maxSize = 0;
    const producer = async (name: string) => {
      for (let i = 0; i < 10; i += 1) {
        await yieldRandomly(rng);
        await queue.put(`${name}-${i}`);
        maxSize = Math.max(maxSize, queue.size);
      }
    };
    const consumer = async (index: number, count: number) => {
      for (let i = 0; i < count; i += 1) {
        await yieldRandomly(rng);
        consumed[index].push(await queue.take());
      }
    };
    await Promise.all([producer('a'), producer('b'), producer('c'), consumer(0, 16), consumer(1, 14)]);

    const all = [...consumed[0], ...consumed[1]];
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
    expect(maxSize).toBeLessThanOrEqual(3);
    for (const list of consumed) {
      for (const name of ['a', 'b', 'c']) {
        const seq = list.filter((x) => x.startsWith(name)).map((x) => Number(x.split('-')[1]));
        expect(seq).toEqual([...seq].sort((x, y) => x - y));
      }
    }
    expect(queue.size).toBe(0);
  });
});

describe('ReadWriteLock', () => {
  it('admits readers together and makes a writer wait for all of them', async () => {
    const lock = new ReadWriteLock();
    await lock.acquireRead();
    await lock.acquireRead();
    expect(lock.activeReaders).toBe(2);
    let writing = false;
    const writer = lock.acquireWrite().then(() => (writing = true));
    lock.releaseRead();
    await nextTurn();
    expect(writing).toBe(false);
    lock.releaseRead();
    await writer;
    expect(lock.isWriteLocked).toBe(true);
    lock.releaseWrite();
    expect(() => lock.releaseWrite()).toThrow(NotLockedError);
    expect(() => lock.releaseRead()).toThrow(NotLockedError);
  });

  it('prefers writers: readers arriving after a waiting writer cannot starve it', async () => {
    const lock = new ReadWriteLock();
    const log: string[] = [];
    await lock.acquireRead();
    const writer = lock.withWriteLock(() => log.push('writer'));
    const lateReaders = [1, 2, 3].map((n) => lock.withReadLock(() => log.push(`reader${n}`)));
    await nextTurn();
    expect(lock.pendingWriters).toBe(1);
    expect(log).toEqual([]); // late readers did not slip in alongside the first reader
    log.push('first reader leaves');
    lock.releaseRead();
    await Promise.all([writer, ...lateReaders]);
    expect(log).toEqual(['first reader leaves', 'writer', 'reader1', 'reader2', 'reader3']);
  });
});

describe('CountDownLatch and Barrier', () => {
  it('a latch opens once the count reaches zero and stays open', async () => {
    const latch = new CountDownLatch(2);
    let open = false;
    const waiter = latch.wait().then(() => (open = true));
    latch.countDown();
    await nextTurn();
    expect(open).toBe(false);
    latch.countDown();
    latch.countDown(); // extra count-downs are ignored
    await waiter;
    expect(latch.count).toBe(0);
    await expect(latch.wait()).resolves.toBeUndefined();
  });

  it('a barrier trips every n arrivals and is reusable', async () => {
    const trips: number[] = [];
    const barrier = new Barrier(3, (generation) => trips.push(generation));
    const first = [barrier.arrive(), barrier.arrive()];
    await nextTurn();
    expect(barrier.waitingCount).toBe(2);
    const generations = await Promise.all([...first, barrier.arrive(), barrier.arrive(), barrier.arrive(), barrier.arrive()]);
    expect(generations).toEqual([0, 0, 0, 1, 1, 1]);
    expect(trips).toEqual([0, 1]);
  });
});

describe('coordination problems', () => {
  it('FooBar alternates foo and bar n times whichever worker starts first', async () => {
    const out: string[] = [];
    const fb = new FooBar(4);
    await Promise.all([fb.bar(() => out.push('bar')), fb.foo(() => out.push('foo'))]);
    expect(out.join('')).toBe('foobar'.repeat(4));
  });

  it('ZeroEvenOdd prints 0 1 0 2 ... 0 n', async () => {
    const out: number[] = [];
    const z = new ZeroEvenOdd(5);
    await Promise.all([z.odd((v) => out.push(v)), z.even((v) => out.push(v)), z.zero((v) => out.push(v))]);
    expect(out).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5]);
  });

  it('H2O releases every group of three as exactly two H and one O, for shuffled arrivals', async () => {
    const rng = seeded(2026);
    for (let round = 0; round < 5; round += 1) {
      const atoms = [...'HHO'.repeat(6)];
      for (let i = atoms.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [atoms[i], atoms[j]] = [atoms[j], atoms[i]];
      }
      const h2o = new H2O();
      const out: string[] = [];
      await Promise.all(
        atoms.map(async (atom) => {
          await yieldRandomly(rng);
          return atom === 'H' ? h2o.hydrogen(() => out.push('H')) : h2o.oxygen(() => out.push('O'));
        }),
      );
      expect(out).toHaveLength(18);
      for (let i = 0; i < out.length; i += 3) {
        expect(out.slice(i, i + 3).sort().join('')).toBe('HHO');
      }
    }
  });
});
