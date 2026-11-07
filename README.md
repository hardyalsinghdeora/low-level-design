# Low-Level Design in TypeScript

[![CI](https://github.com/hardyalsinghdeora/low-level-design/actions/workflows/ci.yml/badge.svg)](https://github.com/hardyalsinghdeora/low-level-design/actions/workflows/ci.yml)

Low-level design (LLD), also called object-oriented design or machine coding, solved the way you would present it in an interview: clarifying questions, requirements, entities, a class diagram, the key flows, the patterns and why they fit, the trade-offs an interviewer will push on, and a working TypeScript implementation with tests.

The problem set follows the questions most often asked in LLD rounds, with extra depth where backend interviews go deep: money (ledgers, splits, proration, order matching), booking contention, and concurrency.

## Quick start

```bash
npm install
npm test                      # runs every problem's test suite
npm run typecheck             # strict TypeScript, no any
npm run demo                  # lists the runnable demos
npm run demo -- parking-lot   # runs one walkthrough
```

Requires Node.js 20 or newer.

## Start here

| Guide | What it covers |
|---|---|
| [How to answer an LLD interview](docs/how-to-answer-lld-interview.md) | A minute-by-minute plan for a 45-60 minute round, what is graded, and the checklist before you say "done" |
| [OOP fundamentals](docs/oop-fundamentals.md) | Encapsulation, abstraction, inheritance vs composition, polymorphism, interfaces and value objects in TypeScript |
| [SOLID principles](docs/solid-principles.md) | Each principle with a before/after example from a billing domain |
| [Class relationships](docs/class-relationships.md) | Association, aggregation, composition, dependency, inheritance and realization |
| [UML cheat sheet](docs/uml-cheatsheet.md) | Class, sequence and state diagrams in Mermaid, rendered by GitHub |
| [Concurrency in LLD](docs/concurrency-in-lld.md) | Where races happen in Node.js and the guards that matter in an answer |
| [Question bank](docs/question-bank.md) | 70+ LLD questions with the trap in each and links to the solved ones |

## Problems

<!-- BEGIN:problems -->
38 problems, each with a write-up and a tested TypeScript solution.

### Easy

| Problem | Patterns and concepts | Code |
|---|---|---|
| [Parking Lot](problems/parking-lot.md) | Strategy, (optional) Singleton, Factory, Observer | [`src/parking-lot`](src/parking-lot/) |
| [Snake and Ladder](problems/snake-and-ladder.md) | Strategy (dice), Result object, polymorphic `Jump`, enum state machine | [`src/snake-and-ladder`](src/snake-and-ladder/) |
| [Tic-Tac-Toe](problems/tic-tac-toe.md) | Strategy, Command-style move history (undo), enum state machine | [`src/tic-tac-toe`](src/tic-tac-toe/) |

### Medium

| Problem | Patterns and concepts | Code |
|---|---|---|
| [ATM](problems/atm.md) | State, Chain of Responsibility, Strategy (bank service interface), Compensating transaction | [`src/atm`](src/atm/) |
| [Car Rental System](problems/car-rental-system.md) | Specification, Strategy, Decorator, State (transition table) | [`src/car-rental-system`](src/car-rental-system/) |
| [Coffee Vending Machine](problems/coffee-vending-machine.md) | Decorator, Observer, Strategy | [`src/coffee-vending-machine`](src/coffee-vending-machine/) |
| [Concert Ticket Booking System](problems/concert-ticket-booking.md) | Strategy (refund), Observer (waitlist offers), State machine, Compensation for atomic orders | [`src/concert-ticket-booking`](src/concert-ticket-booking/) |
| [Course Registration System](problems/course-registration-system.md) | Strategy (rule chain), Observer, State (transition table), Aggregate root | [`src/course-registration-system`](src/course-registration-system/) |
| [Cricinfo (live cricket scoring)](problems/cricinfo.md) | State, Observer, Value Object, Read Model (scorecard) | [`src/cricinfo`](src/cricinfo/) |
| [Digital Wallet](problems/digital-wallet.md) | Double-entry ledger, Strategy, State (transition table), Idempotent Receiver, Compensating Transaction | [`src/digital-wallet`](src/digital-wallet/) |
| [Hotel Management System](problems/hotel-management-system.md) | Strategy (pricing, cancellation), State machine, Aggregate root, Value object | [`src/hotel-management-system`](src/hotel-management-system/) |
| [In-Memory File System](problems/in-memory-file-system.md) | Composite, Specification, Facade (aggregate root) | [`src/in-memory-file-system`](src/in-memory-file-system/) |
| [Library Management System](problems/library-management-system.md) | Strategy, Observer, Specification, State (transition table) | [`src/library-management-system`](src/library-management-system/) |
| [Logging Framework](problems/logging-framework.md) | Strategy (formatters), Chain of Responsibility (logger hierarchy), Decorator (async appender), registry instead of Singleton | [`src/logging-framework`](src/logging-framework/) |
| [LRU Cache (and LFU)](problems/lru-cache.md) | Strategy (eviction policy behind a `Cache` interface), Observer (`onEvict`), composition of data structures | [`src/lru-cache`](src/lru-cache/) |
| [Movie Ticket Booking System](problems/movie-ticket-booking.md) | Strategy (payment, refund), Observer, State machine, TTL lock (lease) | [`src/movie-ticket-booking`](src/movie-ticket-booking/) |
| [Music Streaming Service (Spotify)](problems/music-streaming.md) | State, Strategy (repeat mode, tier, recommendation), Template Method, Facade | [`src/music-streaming`](src/music-streaming/) |
| [Notification Service](problems/notification-service.md) | Strategy (provider per channel, retry policy), Observer (domain events), Decorator (metered provider), State (notification lifecycle) | [`src/notification-service`](src/notification-service/) |
| [Online Auction System](problems/online-auction-system.md) | Strategy, Observer, State (validated transitions), Application Service | [`src/online-auction-system`](src/online-auction-system/) |
| [Online Shopping System](problems/online-shopping.md) | Specification, Strategy (payment, coupons), Observer, State (validated transitions), Idempotency key | [`src/online-shopping`](src/online-shopping/) |
| [Rate Limiter](problems/rate-limiter.md) | Strategy (algorithm, tier resolver), Template Method (store-backed limiter), Decorator / middleware, Composite (tiered limiter) | [`src/rate-limiter`](src/rate-limiter/) |
| [Social Network (Facebook-lite)](problems/social-network.md) | Strategy (feed fan-out), Observer (notifications), State (friend requests), Policy object (visibility), keyset pagination | [`src/social-network`](src/social-network/) |
| [Splitwise (Expense Sharing)](problems/splitwise.md) | Strategy (splits, debt simplification), Observer, Aggregate root, derived read model | [`src/splitwise`](src/splitwise/) |
| [Stack Overflow](problems/stack-overflow.md) | Observer (event bus), Strategy + Composite (search), State (post lifecycle), Interface segregation | [`src/stack-overflow`](src/stack-overflow/) |
| [Task Management System (Jira-lite)](problems/task-management-system.md) | State machine (table-driven State), Composite, Observer, Specification, Strategy | [`src/task-management-system`](src/task-management-system/) |
| [Text Editor with Undo and Redo](problems/text-editor.md) | Command, Composite (macros), Memento (save points), Template Method | [`src/text-editor`](src/text-editor/) |
| [Traffic Signal Control System](problems/traffic-signal-control.md) | State, Strategy, Observer | [`src/traffic-signal-control`](src/traffic-signal-control/) |
| [Vending Machine](problems/vending-machine.md) | State, Strategy | [`src/vending-machine`](src/vending-machine/) |

### Hard

| Problem | Patterns and concepts | Code |
|---|---|---|
| [Airline Management System](problems/airline-management-system.md) | Strategy (fares, cancellation fees), State machine, Static factory, Template vs instance | [`src/airline-management-system`](src/airline-management-system/) |
| [Chess Game](problems/chess-game.md) | Template Method (piece hierarchy), Command (moves with undo), Factory, State (game status) | [`src/chess-game`](src/chess-game/) |
| [Concurrency Primitives (the Node.js answer)](problems/concurrency-primitives.md) | Monitor (condition queues), Producer-consumer, Hand-off (baton passing), Template method (`withLock`) | [`src/concurrency-primitives`](src/concurrency-primitives/) |
| [Food Delivery System](problems/food-delivery.md) | Strategy (dispatch, pricing, cancellation), Decorator (surge), Observer, State machine with actor permissions | [`src/food-delivery`](src/food-delivery/) |
| [LinkedIn (professional network)](problems/linkedin.md) | State (invitation, application), Specification, Repository-style aggregate service, bounded BFS | [`src/linkedin`](src/linkedin/) |
| [Pub-Sub System (Message Broker)](problems/pub-sub-system.md) | Observer vs broker (Publish-Subscribe), State (delivery lifecycle), Strategy (retry policy) | [`src/pub-sub-system`](src/pub-sub-system/) |
| [Restaurant Management System](problems/restaurant-management-system.md) | Strategy, Observer, State (transition table), Aggregate root | [`src/restaurant-management-system`](src/restaurant-management-system/) |
| [Ride-Sharing Service](problems/ride-sharing.md) | Strategy (matching, fare, surge, cancellation), Observer, State (validated transitions), compare-and-set | [`src/ride-sharing`](src/ride-sharing/) |
| [Stock Brokerage (Order Matching)](problems/stock-brokerage.md) | Strategy (fees), Observer (executions), State (order lifecycle), Aggregate root | [`src/stock-brokerage`](src/stock-brokerage/) |
| [Subscription Billing System](problems/subscription-billing.md) | Strategy (proration, retry schedule), State (subscription and invoice lifecycles), Adapter (payment gateway), Idempotency key | [`src/subscription-billing`](src/subscription-billing/) |
<!-- END:problems -->

## What every solution contains

Each problem has a write-up in [`problems/`](problems/) and a solution in [`src/`](src/):

1. Clarifying questions and the assumptions taken.
2. Functional and non-functional requirements.
3. Core entities and a Mermaid class diagram.
4. Sequence diagrams for the main flow and a failure path.
5. The design patterns used, why they fit, and one alternative.
6. Trade-offs and follow-ups: concurrency, scaling and persistence.
7. A five-step outline of what a strong interview answer sounds like.
8. A TypeScript implementation with domain errors, a runnable demo, and vitest tests for happy paths, failure paths and invariants.

Conventions such as money in integer minor units, injected clocks and id generators, and validated state machines are in [STYLE.md](STYLE.md).

## Design patterns

The patterns used here are explained in depth, with their own examples and tests, in the companion repository [design-patterns](https://github.com/hardyalsinghdeora/design-patterns).

<!-- BEGIN:patterns -->
| Category | Patterns |
|---|---|
| Creational | [Singleton](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/creational/singleton), [Factory Method](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/creational/factory-method), [Abstract Factory](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/creational/abstract-factory), [Builder](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/creational/builder), [Prototype](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/creational/prototype) |
| Structural | [Adapter](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/adapter), [Bridge](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/bridge), [Composite](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/composite), [Decorator](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/decorator), [Facade](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/facade), [Flyweight](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/flyweight), [Proxy](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/proxy) |
| Behavioral | [Chain of Responsibility](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/chain-of-responsibility), [Command](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/command), [Iterator](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/iterator), [Mediator](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/mediator), [Memento](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/memento), [Observer](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/observer), [State](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/state), [Strategy](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/strategy), [Template Method](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/template-method), [Visitor](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/visitor), [Interpreter](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/interpreter) |
| Modern backend | [Repository](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/repository), [Unit of Work](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/unit-of-work), [Specification](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/specification), [Null Object](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/null-object), [Dependency Injection](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/dependency-injection), [Object Pool](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/object-pool), [Middleware Pipeline](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/middleware-pipeline), [Circuit Breaker](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/circuit-breaker), [Retry with Backoff](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/retry-with-backoff), [Bulkhead](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/bulkhead), [Saga](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/saga), [CQRS (Command Query Responsibility Segregation)](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/cqrs), [Event Sourcing](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/event-sourcing) |
<!-- END:patterns -->

## Repository layout

```
docs/            interview guides: approach, OOP, SOLID, UML, concurrency, question bank
problems/        one write-up per problem
src/<problem>/   the solution: entities, strategies, errors, demo.ts, <problem>.test.ts
src/shared/      Clock, IdGenerator, Money and DomainError used by every solution
scripts/         demo runner
```

## Companion repositories

- [design-patterns](https://github.com/hardyalsinghdeora/design-patterns): the 23 GoF patterns plus modern backend patterns, in TypeScript.
- [system-design](https://github.com/hardyalsinghdeora/system-design): high-level design fundamentals, classic interview problems and runnable building blocks.

## Acknowledgements

The problem list was shaped by [ashishps1/awesome-low-level-design](https://github.com/ashishps1/awesome-low-level-design). The write-ups and code in this repository are original.

## License

[MIT](LICENSE)
