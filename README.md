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
8 problems, each with a write-up and a tested TypeScript solution.

### Easy

| Problem | Patterns and concepts | Code |
|---|---|---|
| [Parking Lot](problems/parking-lot.md) | Strategy, (optional) Singleton, Factory, Observer | [`src/parking-lot`](src/parking-lot/) |
| [Snake and Ladder](problems/snake-and-ladder.md) | Strategy (dice), Result object, polymorphic `Jump`, enum state machine | [`src/snake-and-ladder`](src/snake-and-ladder/) |
| [Tic-Tac-Toe](problems/tic-tac-toe.md) | Strategy, Command-style move history (undo), enum state machine | [`src/tic-tac-toe`](src/tic-tac-toe/) |

### Medium

| Problem | Patterns and concepts | Code |
|---|---|---|
| [Car Rental System](problems/car-rental-system.md) | Specification, Strategy, Decorator, State (transition table) | [`src/car-rental-system`](src/car-rental-system/) |
| [Digital Wallet](problems/digital-wallet.md) | Double-entry ledger, Strategy, State (transition table), Idempotent Receiver, Compensating Transaction | [`src/digital-wallet`](src/digital-wallet/) |
| [Social Network (Facebook-lite)](problems/social-network.md) | Strategy (feed fan-out), Observer (notifications), State (friend requests), Policy object (visibility), keyset pagination | [`src/social-network`](src/social-network/) |
| [Stack Overflow](problems/stack-overflow.md) | Observer (event bus), Strategy + Composite (search), State (post lifecycle), Interface segregation | [`src/stack-overflow`](src/stack-overflow/) |
| [Task Management System (Jira-lite)](problems/task-management-system.md) | State machine (table-driven State), Composite, Observer, Specification, Strategy | [`src/task-management-system`](src/task-management-system/) |
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
| Creational | [Singleton](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/creational/singleton) |
| Structural |  |
| Behavioral | [Chain of Responsibility](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/chain-of-responsibility), [Strategy](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/strategy) |
| Modern backend |  |
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
