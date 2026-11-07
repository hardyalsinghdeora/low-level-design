# OOP fundamentals in TypeScript

LLD rounds grade object-oriented modelling, and TypeScript differs from Java and C# in ways that matter: types are structural, `private` disappears at runtime, and enums come in several flavours. This page covers the concepts with examples from the problems in this repository. The principles built on top of them are in [SOLID principles](solid-principles.md).

## Classes and objects

A class bundles state with the only operations allowed to change it; an object is one instance with its own identity and state. Most classes in an LLD answer are one of two kinds:

| | Entity | Value object |
|---|---|---|
| Identity | An id that survives state changes | None: it is its values |
| Equality | Same id | Same field values |
| Mutability | Changes through methods that check rules | Immutable; replaced, never edited |
| Examples | `ParkingSpot`, `Order`, `Account`, `ShowSeat` | `Money`, `TimeSlot`, `Address`, a chess `Position` |
| Persistence | Its own row | Columns inside the owner's row |

An entity's public methods are the domain's verbs. A seat for one show in [movie ticket booking](../problems/movie-ticket-booking.md):

```ts
import { DomainError } from '../src/shared/errors';

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  BOOKED = 'BOOKED',
}

export class SeatUnavailableError extends DomainError {}

/** Identity is (showId, seatId). State changes only through hold() and book(). */
export class ShowSeat {
  private status = SeatStatus.AVAILABLE;
  private holder: string | null = null;

  constructor(
    readonly showId: string,
    readonly seatId: string,
  ) {}

  hold(userId: string): void {
    if (this.status !== SeatStatus.AVAILABLE) throw new SeatUnavailableError(`${this.seatId} is ${this.status}`);
    this.status = SeatStatus.HELD;
    this.holder = userId;
  }

  book(userId: string): void {
    if (this.status !== SeatStatus.HELD || this.holder !== userId) {
      throw new SeatUnavailableError(`${this.seatId} is not held by ${userId}`);
    }
    this.status = SeatStatus.BOOKED;
  }
}
```

## Encapsulation

Encapsulation means no caller can put an object into an invalid state. Fields are private; the public surface is commands that check rules and queries that do not leak mutable internals. Without it, any caller can write `wallet.balance = -500`. With it, as in a [digital wallet](../problems/digital-wallet.md):

```ts
import { DomainError } from '../src/shared/errors';
import { assertMoney, type Money } from '../src/shared/money';

export class InsufficientFundsError extends DomainError {}

interface LedgerEntry {
  readonly amount: Money; // positive for a credit, negative for a debit
  readonly reason: string;
}

export class Wallet {
  private balance: Money = 0;
  private readonly entries: LedgerEntry[] = [];

  constructor(readonly id: string) {}

  get currentBalance(): Money {
    return this.balance;
  }

  /** A read-only view: callers cannot push without a cast. */
  get history(): readonly LedgerEntry[] {
    return this.entries;
  }

  credit(amount: Money, reason: string): void {
    assertMoney(amount);
    this.balance += amount;
    this.entries.push({ amount, reason });
  }

  debit(amount: Money, reason: string): void {
    assertMoney(amount);
    if (amount > this.balance) throw new InsufficientFundsError(`${this.id} has ${this.balance}, needs ${amount}`);
    this.balance -= amount;
    this.entries.push({ amount: -amount, reason });
  }
}
```

`readonly LedgerEntry[]` is a compile-time view. When even a cast must not reach internal state, return a copy, as [`ParkingFloor.allSpots`](../src/parking-lot/parking-floor.ts) does.

## Abstraction

Abstraction decides what a caller needs to know; encapsulation protects how it is done. `ParkingLot.unpark()` calls `this.feeStrategy.calculate(ticket, exitTime)` and never learns whether the fee is hourly or flat ([`strategies/fee.ts`](../src/parking-lot/strategies/fee.ts)). The repository's [`Clock`](../src/shared/clock.ts) does the same for time: code depends on `now()`, and tests substitute `FakeClock`.

A good abstraction is named after its role in the domain (`FeeStrategy`, `NotificationChannel`), exposes the fewest methods its callers need, and leaks no implementation detail (no `getRedisClient()` on a `RateLimiter`).

## Inheritance versus composition

Inheritance shares code by making a subclass a kind of its parent. The relationship is fixed at compile time and total: the subclass inherits every method and every future change to the parent. Composition shares code by holding collaborators behind interfaces, so behaviour is chosen per instance when it is constructed.

A [logging framework](../problems/logging-framework.md) built on inheritance needs a class per combination of format and destination:

```ts
class ConsoleLogger {
  log(level: string, message: string): void {
    process.stdout.write(`${level} ${message}\n`);
  }
}

class TimestampedConsoleLogger extends ConsoleLogger {
  override log(level: string, message: string): void {
    super.log(level, `${new Date().toISOString()} ${message}`);
  }
}

// FileLogger, TimestampedFileLogger (timestamp code copied again), JsonFileLogger, ...
```

The refactor gives each axis of change (format, destination) its own interface and composes them:

```ts
import { SystemClock, type Clock } from '../src/shared/clock';

export enum LogLevel { DEBUG = 'DEBUG', INFO = 'INFO', WARN = 'WARN', ERROR = 'ERROR' }

export interface LogRecord { level: LogLevel; message: string; at: Date }
export interface Formatter { format(record: LogRecord): string }
export interface Appender { append(line: string): void }

export class TextFormatter implements Formatter {
  format(r: LogRecord): string { return `${r.at.toISOString()} ${r.level} ${r.message}`; }
}
export class JsonFormatter implements Formatter {
  format(r: LogRecord): string { return JSON.stringify({ ...r, at: r.at.toISOString() }); }
}
export class ConsoleAppender implements Appender {
  append(line: string): void { process.stdout.write(`${line}\n`); }
}
export class MemoryAppender implements Appender {
  readonly lines: string[] = [];
  append(line: string): void { this.lines.push(line); }
}

export class Logger {
  constructor(
    private readonly formatter: Formatter,
    private readonly appenders: readonly Appender[],
    private readonly clock: Clock = new SystemClock(),
  ) {}

  log(level: LogLevel, message: string): void {
    const line = this.formatter.format({ level, message, at: this.clock.now() });
    for (const appender of this.appenders) appender.append(line);
  }
}

// JSON to the console and to memory: a new combination is a constructor call, not a subclass.
new Logger(new JsonFormatter(), [new ConsoleAppender(), new MemoryAppender()]).log(LogLevel.INFO, 'started');
```

N formats and M destinations now cost N + M classes instead of N × M, each testable alone, and the timestamp comes from an injected clock. Inheritance remains the right tool when the subtype keeps every promise of its parent ([Liskov](solid-principles.md#l-liskov-substitution)) and either the parent holds an invariant all subtypes need ([`Vehicle`](../src/parking-lot/vehicle.ts) validates the plate in a `protected` constructor) or the algorithm has a fixed skeleton with variable steps ([Template Method](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/template-method)). Keep hierarchies one level deep; a third level usually hides a missing composition.

## Polymorphism

One call site, many behaviours. TypeScript has three kinds, and LLD answers use all three.

**Subtype polymorphism.** The caller depends on an interface or base class and the object decides what runs. `lot.setFeeStrategy(new FlatRateFeeStrategy(15_000))` changes pricing at runtime without touching `ParkingLot`. Strategy, State and Command all rest on this.

**Parametric polymorphism (generics).** One implementation for many types, checked at each use. [LRU cache](../problems/lru-cache.md) is the classic generic class (`LruCache<K, V>`); repositories are the everyday one:

```ts
export interface Repository<T extends { readonly id: string }> {
  save(entity: T): void;
  findById(id: string): T | undefined;
}

export class InMemoryRepository<T extends { readonly id: string }> implements Repository<T> {
  private readonly rows = new Map<string, T>();
  save(entity: T): void { this.rows.set(entity.id, entity); }
  findById(id: string): T | undefined { return this.rows.get(id); }
}

interface Booking { readonly id: string; readonly roomId: string }
const bookings = new InMemoryRepository<Booking>();
bookings.save({ id: 'B-1', roomId: '101' });
```

**Ad hoc polymorphism.** Behaviour depends on the argument's type, through overload signatures or a narrowed union:

```ts
interface Book { isbn: string; title: string; author: string }
interface BookQuery { title?: string; author?: string }

/** library-management-system: overloads make the return type follow the argument. */
export class Catalog {
  constructor(private readonly books: readonly Book[]) {}

  find(isbn: string): Book | undefined;
  find(query: BookQuery): Book[];
  find(arg: string | BookQuery): Book | Book[] | undefined {
    if (typeof arg === 'string') return this.books.find((b) => b.isbn === arg);
    return this.books.filter((b) => (!arg.title || b.title.includes(arg.title)) && (!arg.author || b.author === arg.author));
  }
}

/** chess-game: a discriminated union with an exhaustive switch. */
export type Move =
  | { kind: 'step'; from: string; to: string }
  | { kind: 'castle'; side: 'KING' | 'QUEEN' }
  | { kind: 'promotion'; from: string; to: string; piece: 'Q' | 'R' | 'B' | 'N' };

export function notation(move: Move): string {
  switch (move.kind) {
    case 'step': return `${move.from}-${move.to}`;
    case 'castle': return move.side === 'KING' ? 'O-O' : 'O-O-O';
    case 'promotion': return `${move.from}-${move.to}=${move.piece}`;
    default: return assertNever(move); // adding a variant breaks compilation here
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
```

Choose between an interface and a union by asking which axis grows. If new variants keep arriving (fee rules, notification channels, payment providers), use an interface and add classes. If the set of variants is closed and new operations keep arriving (render a move, validate it, serialise it), use a discriminated union and let the exhaustive `switch` point at every place a new variant must be handled.

## Interfaces versus abstract classes

| | `interface` | `abstract class` |
|---|---|---|
| Exists at runtime | No, erased | Yes, a constructor function |
| `instanceof` | Not possible | Works |
| Implementation and state | None | Fields, constructor logic, concrete methods |
| Per class | Implement any number | Extend exactly one |
| Visibility | Everything public | `protected` hooks and constructors |
| Can describe plain objects and functions | Yes | No |
| Use for | Policies and ports: `FeeStrategy`, `Clock`, `Repository<T>` | Shared invariants and Template Method skeletons: `Vehicle`, `Piece` |

Default to interfaces. Use an abstract class when every subtype must run the same code:

```ts
export enum Color { WHITE = 'WHITE', BLACK = 'BLACK' }
export interface Position { file: number; rank: number } // 0-7 each

/** chess-game: the shared rule runs first, the piece's geometry second. */
export abstract class Piece {
  protected constructor(readonly color: Color) {}

  canMove(from: Position, to: Position): boolean {
    const df = Math.abs(to.file - from.file);
    const dr = Math.abs(to.rank - from.rank);
    if (df === 0 && dr === 0) return false; // every piece: a move must go somewhere
    return this.isValidShape(df, dr);
  }

  protected abstract isValidShape(df: number, dr: number): boolean;
}

export class Knight extends Piece {
  constructor(color: Color) { super(color); }
  protected isValidShape(df: number, dr: number): boolean { return (df === 1 && dr === 2) || (df === 2 && dr === 1); }
}
```

Domain errors are classes for the same runtime reason: `catch (e) { if (e instanceof SeatUnavailableError) ... }` needs a constructor to test against, which is why every error in this repository extends [`DomainError`](../src/shared/errors.ts).

## Enums: string enums or union types

```ts
// String enum: a runtime object and a type. The repository default for finite states (STYLE.md).
export enum OrderStatus { PLACED = 'PLACED', PAID = 'PAID', SHIPPED = 'SHIPPED' }
const every: OrderStatus[] = Object.values(OrderStatus); // iterable at runtime
// @ts-expect-error: a raw string is not an OrderStatus, even when the value matches
const fromJson: OrderStatus = 'PAID';

// Union of string literals: type only, erased at compile time. Literals are assignable directly.
export type PaymentKind = 'CARD' | 'UPI' | 'WALLET';
const kind: PaymentKind = 'UPI';

// `as const` object: runtime values plus a union type, without enum syntax.
export const Direction = { UP: 'UP', DOWN: 'DOWN', IDLE: 'IDLE' } as const;
export type Direction = (typeof Direction)[keyof typeof Direction]; // 'UP' | 'DOWN' | 'IDLE'

/** Validate untrusted input once at the boundary; the rest of the code trusts the type. */
export function isOrderStatus(value: string): value is OrderStatus {
  return (Object.values(OrderStatus) as string[]).includes(value);
}
```

| Situation | Use |
|---|---|
| Entity states and categories that are stored, logged and iterated (`OrderStatus`, `SpotSize`) | String enum |
| Discriminants in unions, small option sets in parameters, values crossing a JSON boundary | Union of literals |
| Runtime values needed, but the toolchain forbids enums (`erasableSyntaxOnly`, Node's built-in type stripping) | `as const` object |
| Never | Numeric enums: logs show `2` instead of `PAID`, and any `number` variable is assignable to one |

Pair enums with `Record<Enum, T>` tables for exhaustiveness. [`MIN_SPOT_SIZE`](../src/parking-lot/parking-spot.ts) is a `Record<VehicleType, SpotSize>`: add `VehicleType.BUS` and the code stops compiling until the table says where a bus fits.

## Immutability and value objects

A value object is valid by construction, compared by value and never changed; an "update" returns a new instance. Nobody can then move a booking's time slot behind the booking's back.

```ts
/** meeting-scheduler, hotel bookings: the half-open interval [start, end). */
export class TimeSlot {
  private constructor(
    readonly startMs: number,
    readonly endMs: number,
  ) {}

  static of(start: Date, end: Date): TimeSlot {
    if (end.getTime() <= start.getTime()) throw new RangeError('end must be after start');
    return new TimeSlot(start.getTime(), end.getTime());
  }

  get start(): Date { return new Date(this.startMs); } // Date is mutable: hand out a copy
  overlaps(other: TimeSlot): boolean { return this.startMs < other.endMs && other.startMs < this.endMs; }
  extendBy(minutes: number): TimeSlot { return new TimeSlot(this.startMs, this.endMs + minutes * 60_000); }
  equals(other: TimeSlot): boolean { return this.startMs === other.startMs && this.endMs === other.endMs; }
}
```

- `readonly` is shallow and compile-time only. `readonly items: Item[]` blocks reassignment, not `items.push()`. Use `readonly Item[]`, `ReadonlyMap` and `Readonly<T>` for contents, and `Object.freeze` when you need a runtime guarantee.
- `Date` is mutable. Store epoch milliseconds, or copy on the way in and out; [`FakeClock.now()`](../src/shared/clock.ts) returns a new `Date` for this reason.
- The repository's [`Money`](../src/shared/money.ts) is an integer in minor units. A richer value object would carry the currency and refuse to add amounts in different currencies.

## Static versus instance members

Static members belong to the class, so they are shared by every instance in the process. Static state is therefore a hidden global:

```ts
// Every lot in every test shares this counter, so test order changes ticket ids.
export class Ticket {
  private static nextId = 1;
  readonly id = `TKT-${Ticket.nextId++}`;
}
```

The repository injects an [`IdGenerator`](../src/shared/id-generator.ts) instead (`this.ids.next('TKT')` in [`parking-lot.ts`](../src/parking-lot/parking-lot.ts)), so each lot and each test owns its sequence. Static is right for stateless members: named constructors (`TimeSlot.of`), pure helpers, constants. `static getInstance()` is the same hidden global with a pattern name attached.

## Access modifiers and readonly

| Modifier | Enforced | Visible to | Typical use |
|---|---|---|---|
| `public` (default) | Compile time | Everyone | Commands and queries that form the API |
| `protected` | Compile time | The class and subclasses | Template Method hooks, `protected constructor` on abstract bases |
| `private` | Compile time only; erased from the JavaScript | The class (bracket access `obj['field']` still compiles) | Internal state; the repository default |
| `#field` | Runtime (ECMAScript private) | The class only; absent from `JSON.stringify` and `Object.keys` | Secrets and library internals |
| `readonly` | Compile time | Not a visibility: blocks reassignment after construction | Ids, injected dependencies, value object fields |

```ts
/** atm: the PIN hash never leaves the object, not even through serialisation. */
export class Card {
  readonly #pinHash: string;

  constructor(
    readonly cardNumber: string, // parameter property: declares and assigns the field
    pinHash: string,
  ) {
    this.#pinHash = pinHash;
  }

  verify(pinHash: string): boolean {
    return this.#pinHash === pinHash; // use a constant-time comparison in production code
  }
}

const card = new Card('4111-0000', 'h-91');
// @ts-expect-error: cardNumber is readonly
card.cardNumber = '0000';
JSON.stringify(card); // '{"cardNumber":"4111-0000"}'
```

## Structural typing: what `implements` means

TypeScript compares types by shape, not by name. `implements` asks the compiler to check a class against an interface; it is optional and changes nothing at runtime.

```ts
interface FeeStrategy { calculate(minutes: number): number }

// No `implements`, still a FeeStrategy: the shape matches.
const flat = { calculate: (_minutes: number) => 500 };
const strategy: FeeStrategy = flat;

// Two unrelated classes with the same shape are interchangeable.
class Celsius { constructor(readonly value: number) {} }
class Fahrenheit { constructor(readonly value: number) {} }
const boiling: Celsius = new Fahrenheit(212); // compiles

// Branded ids cannot be mixed up.
type UserId = string & { readonly __brand: 'UserId' };
type OrderId = string & { readonly __brand: 'OrderId' };
function cancelOrder(id: OrderId): void {}
// @ts-expect-error: a UserId is not an OrderId
cancelOrder('u-1' as UserId);
```

What this means for an LLD answer:

- There is no `instanceof FeeStrategy`. Dispatch on a discriminant field (`kind`) or a user-defined type guard instead.
- `implements` does not type the class for you: in `class Flat implements FeeStrategy { calculate(minutes) { ... } }`, `minutes` is an implicit `any`, which `strict` rejects. Annotate parameters.
- A class with a `private` or `#private` member is compared nominally, so adding one stops `Fahrenheit` passing as `Celsius`.
- Excess property checks apply only to fresh object literals; a variable carrying extra fields passes.
- Method parameters are checked bivariantly, so an implementation can narrow a parameter type and still compile. That is a Liskov violation the compiler misses; [SOLID principles](solid-principles.md#l-liskov-substitution) shows the example and the fix.
- Test doubles are cheap: any object literal with the right methods satisfies an interface, with no mocking library.
