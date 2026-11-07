# Conventions for this repository

Every problem follows the same shape so the repo reads like one book, not thirty blog posts.

## Layout

```
problems/<slug>.md          the write-up (requirements, diagram, flows, patterns, trade-offs)
src/<slug>/                 the solution
  <entity>.ts               one file per entity / value object / enum group (kebab-case)
  strategies/, services/    optional sub-folders when a problem has several policies or services
  errors.ts                 domain errors extending DomainError (src/shared/errors.ts)
  index.ts                  barrel export of the public surface
  demo.ts                   console walkthrough: `npm run demo -- <slug>`
  <slug>.test.ts            vitest tests for the main flows, failure paths and invariants
src/shared/                 Clock, IdGenerator, Money, DomainError. Reuse them; do not reinvent them.
```

## The write-up (`problems/<slug>.md`)

Use exactly these sections, in this order. `problems/parking-lot.md` is the reference.

1. Header table: difficulty, solution link, run commands, patterns.
2. **Problem statement** (2-3 sentences).
3. **Clarifying questions to ask first**, then the assumptions the solution makes.
4. **Requirements**: functional (numbered) and non-functional.
5. **Core entities** table: entity → responsibility.
6. **Class diagram** in Mermaid (`classDiagram`). Show interfaces with `<<interface>>`, enums with `<<enumeration>>`, and the real relationships (`*--` composition, `o--` aggregation, `-->` association, `<|--` inheritance, `<|..` implementation).
7. **Key flows** as Mermaid `sequenceDiagram` (one or two, including a failure branch).
8. **Design patterns used**: name the pattern, say *why* it applies here, and mention one alternative.
9. **Trade-offs, extensions and follow-up questions**: concurrency, performance, persistence sketch, 3-5 "what if" follow-ups an interviewer would ask.
10. **What a strong interview answer sounds like**: 5 numbered steps.

## The code

- Strict TypeScript, no `any`, no `// @ts-ignore`. `npm run typecheck` must pass.
- String enums for finite states (`enum OrderStatus { PLACED = 'PLACED', ... }`); state transitions are validated, invalid transitions throw.
- Interfaces for every policy that can vary (Strategy), so the core never switches on type.
- Domain errors are classes extending `DomainError`; never throw strings; never return `null` to signal failure in a command.
- Money is an integer in minor units (`Money` from `src/shared/money.ts`). Never floats.
- Time and ids are injected (`Clock`, `IdGenerator`); demos and tests use `FakeClock` and `SequentialIdGenerator`.
- Entities protect their invariants (e.g. `ParkingSpot.park()` throws if occupied). The aggregate root is the only place that orchestrates several entities.
- No `console.log` outside `demo.ts`.
- Comments explain *why*, not *what*. A short doc comment on each class is enough.
- Tests: cover the happy path, every domain error, at least one invariant, and any strategy variants. Aim for 8-15 focused tests per problem. Tests must not depend on real time or randomness.
- Demo: a readable story in 40-80 lines that prints the interesting states, including one failure handled explicitly.

## Concurrency note

Node.js is single-threaded, but the same races exist between `await`s and across processes. Solutions model the guard that matters (compare-and-set on the entity, versioned updates, idempotency keys) and the write-up explains how it maps to a database (`UPDATE ... WHERE version = ?`) or a lock service. Do not sprinkle fake mutexes.
