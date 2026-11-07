import { setImmediate as nextTurn } from 'node:timers/promises';
import { BoundedBlockingQueue, FooBar, H2O, Mutex, ReadWriteLock, ZeroEvenOdd } from './index';

console.log('\n--- Lost update between awaits, then fixed with a Mutex ---');
let balance = 0;
const deposit = async (): Promise<void> => {
  const read = balance;
  await Promise.resolve(); // any await is a point where another task can run
  balance = read + 100;
};
await Promise.all([deposit(), deposit(), deposit()]);
console.log(`  without a lock: 3 deposits of 100 -> balance ${balance}`);
balance = 0;
const mutex = new Mutex();
await Promise.all([1, 2, 3].map(() => mutex.withLock(deposit)));
console.log(`  with withLock:  3 deposits of 100 -> balance ${balance}`);
try {
  mutex.release();
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- Producer/consumer with backpressure (capacity 2) ---');
const queue = new BoundedBlockingQueue<string>(2);
const consumed: string[] = [];
let blockedPuts = 0;
let maxSize = 0;
const producer = async (name: string): Promise<void> => {
  for (let i = 1; i <= 3; i += 1) {
    if (queue.size === queue.capacity) blockedPuts += 1; // this put will wait for a take
    await queue.put(`${name}${i}`);
    maxSize = Math.max(maxSize, queue.size);
  }
};
const consumer = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await nextTurn(); // a slow consumer: producers must wait
    consumed.push(await queue.take());
  }
};
await Promise.all([producer('a'), producer('b'), consumer()]);
console.log(`  consumed in order: ${consumed.join(' ')}`);
console.log(`  ${blockedPuts} puts waited on a full queue; size never exceeded ${maxSize}`);

console.log('\n--- Writer preference: a reader arriving after a waiting writer waits ---');
const rw = new ReadWriteLock();
const order: string[] = [];
await rw.acquireRead();
order.push('reader 1 in');
const writer = rw.withWriteLock(() => order.push('writer in'));
const lateReader = rw.withReadLock(() => order.push('reader 2 in'));
await nextTurn();
order.push(`(writer pending: ${rw.pendingWriters}) reader 1 out`);
rw.releaseRead();
await Promise.all([writer, lateReader]);
console.log(`  ${order.join(' -> ')}`);

console.log('\n--- Classic coordination problems ---');
const fooBar: string[] = [];
const fb = new FooBar(3);
await Promise.all([fb.bar(() => fooBar.push('bar')), fb.foo(() => fooBar.push('foo'))]);
console.log(`  FooBar(3):       ${fooBar.join('')}`);
const zeo: number[] = [];
const z = new ZeroEvenOdd(5);
await Promise.all([z.even((v) => zeo.push(v)), z.odd((v) => zeo.push(v)), z.zero((v) => zeo.push(v))]);
console.log(`  ZeroEvenOdd(5):  ${zeo.join(' ')}`);
const water: string[] = [];
const h2o = new H2O();
const atoms = 'OOHHHHHHO';
await Promise.all([...atoms].map((a) => (a === 'H' ? h2o.hydrogen(() => water.push('H')) : h2o.oxygen(() => water.push('O')))));
console.log(`  H2O from ${atoms}: ${water.join('').match(/.{3}/g)?.join(' ')}`);
