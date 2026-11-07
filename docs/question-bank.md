# LLD question bank

Commonly asked low-level design prompts, grouped by domain. For each: a difficulty for a 45-60 minute round, the patterns or concepts it tests, and the part candidates usually get wrong. Linked questions have a full write-up and solution in this repository. Patterns link to the [design-patterns repository](https://github.com/hardyalsinghdeora/design-patterns) rather than being explained here.

How to use it: pick a group, answer the prompt aloud with the [interview plan](how-to-answer-lld-interview.md), then check the trap column. If your design does not handle the trap, that is the follow-up you would have been asked.

Difficulty: **E** easy, **M** medium, **H** hard.

## Machines and simulations

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Parking lot](../problems/parking-lot.md) | E | Strategy for spot choice and pricing, composition, compare-and-set | Two gates assigning one spot; one active ticket per plate |
| [Vending machine](../problems/vending-machine.md) | E | State, inventory, change-making | Returning change from a limited coin stock; refund on cancel from every state |
| [Coffee vending machine](../problems/coffee-vending-machine.md) | M | Recipes as data or Builder, State, ingredient inventory | Reserving every ingredient before brewing; what happens if one runs out mid-order |
| [Traffic signal control](../problems/traffic-signal-control.md) | M | State, Observer, timing with an injected clock | Never green on conflicting directions; emergency override and resuming the cycle |
| [ATM](../problems/atm.md) | M | State, Chain of Responsibility for notes, Adapter to the bank | Debit succeeds but dispensing fails: compensation; PIN retry limits |
| [Elevator system](../problems/elevator-system.md) | H | Dispatch Strategy, State per car, SCAN or LOOK scheduling | Which car serves a hall call; direction changes; requests starving at far floors |
| EV charging station | M | Slot booking, State per charger, pricing Strategy | Overstay after charging ends; a charger faulting mid-session |
| Toll plaza | E | Pricing per vehicle class, Adapter for tag readers | Duplicate tag reads for one pass: idempotency |
| Washing machine controller | E | State, Template Method for programs | Door opened or power lost mid-cycle; pause and resume |

## Booking

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Hotel management](../problems/hotel-management-system.md) | M | Date-range availability, booking State, pricing Strategy | Overlapping date ranges; overbooking under concurrent requests |
| [Movie ticket booking](../problems/movie-ticket-booking.md) | M | Seat hold with expiry, State per show seat, unique constraint | Two users picking the same seat; holds that never release |
| [Concert ticket booking](../problems/concert-ticket-booking.md) | H | Inventory per tier, waiting room, idempotent purchase | Flash-sale contention; payment timeouts releasing holds fairly |
| [Airline management](../problems/airline-management-system.md) | H | Route versus flight instance, seat maps, fare classes | Rebooking passengers when a flight is cancelled |
| [Meeting scheduler](../problems/meeting-scheduler.md) | M | Interval overlap, room allocation Strategy, Observer for invites | Conflicts across attendees and rooms; recurring meetings; time zones |
| [Car rental](../problems/car-rental-system.md) | M | Reservation lifecycle, pricing Strategy, fleet per branch | Availability by date range; late returns and one-way drop-offs |
| Doctor appointment booking | M | Slot generation, cancellation policy, notifications | Slots derived from working hours and leave; double booking a doctor |
| Train or bus reservation | H | Seat availability per segment, waitlist | A seat free on A-B and C-D but not B-C; waitlist promotion on cancellation |
| Restaurant table reservation | E | Table allocation Strategy, time windows | Combining tables for a large party; releasing no-shows |
| Co-working desk booking | E | Recurring bookings, check-in expiry | Auto-release when nobody checks in |

## Marketplaces and commerce

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Online shopping](../problems/online-shopping.md) | M | Cart, order State, inventory reservation, payment Adapter | Reserve stock at checkout or decrement on payment; orders split across sellers |
| [Food delivery](../problems/food-delivery.md) | H | Order State, partner assignment Strategy, Observer | Assigning a delivery partner; cancellation after the kitchen starts |
| [Ride sharing](../problems/ride-sharing.md) | H | Matching Strategy, trip State, surge pricing | One driver accepting two rides; widening the search radius |
| [Online auction](../problems/online-auction-system.md) | M | Observer for bids, auction State, clock-driven close | Concurrent bids at the closing second; anti-sniping extensions |
| Shopping cart with coupons and offers | M | Rule chain, Strategy, integer money | Stacking order of offers; rounding percentage discounts |
| Inventory and warehouse management | M | Stock movements as a ledger, reservations | A mutable count versus stock derived from movements |
| Price-drop alerts | E | Observer, scheduled checks | Deduplicating alerts; per-user thresholds |
| Rental marketplace (Airbnb-style) | H | Listings, availability calendar, host approval | Instant book versus request-to-book lifecycles |
| Ratings and reviews | E | Aggregates, moderation State | Updating averages incrementally; one review per purchase |

## Money

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Digital wallet](../problems/digital-wallet.md) | M | Ledger entries, idempotency keys, optimistic locking | Atomic transfers; no negative balance; a retry charging twice |
| [Splitwise](../problems/splitwise.md) | M | Split Strategy (equal, exact, percent), balance graph | Distributing rounding remainders; simplifying debts |
| [Stock brokerage](../problems/stock-brokerage.md) | H | Order book, matching, order State | Price-time priority; partial fills; a cancel racing a fill |
| [Subscription billing](../problems/subscription-billing.md) | H | Billing cycles, proration, dunning State | Mid-cycle plan changes; retrying failed renewals without double charging |
| Payment gateway | H | Adapter per provider, payment State, webhooks | A webhook arriving before the API response; idempotent capture and refund |
| Banking system | M | Accounts, double-entry ledger, statements | Two opposite transfers deadlocking; balance as a derived value |
| Loyalty points | M | Ledger with expiry buckets | Expiring points first in, first out; reversing points on a refund |
| Multi-currency wallet | M | Money value objects, rate snapshots | Locking the rate at quote time; currencies with different minor units |
| Expense tracker | E | Categories, recurring rules | Recurring entries across month ends |

## Social and content

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Stack Overflow](../problems/stack-overflow.md) | M | Voting, reputation rules, Observer | One vote per user per post; reversing reputation when a vote changes |
| [Social network](../problems/social-network.md) | M | Follow graph, feed generation, privacy | Fan-out on write versus read; applying privacy to feed items |
| [LinkedIn](../problems/linkedin.md) | M | Connections, degrees, search, messaging | Second-degree queries; connection request states |
| [Music streaming](../problems/music-streaming.md) | M | Playlists as aggregation, player State, Iterator | Shuffle and repeat semantics; play queue versus playlist |
| [Cricinfo](../problems/cricinfo.md) | M | Ball-by-ball events, Observer for live scores | Deriving scorecards from events; correcting a recorded ball |
| News feed (Twitter-style) | M | Observer, timeline merge | Merging k sorted timelines; accounts with millions of followers |
| Chat application | M | Conversations, receipts, Observer | Message ordering; sent, delivered and read states in groups |
| URL shortener | E | Id generation, encoding, expiry | Collisions; custom aliases; the same long URL twice |
| Threaded comments and voting | M | Composite for threads, ranking Strategy | Deep nesting; hot versus top ranking |
| Video platform | M | Upload processing State, channels, subscriptions | Processing states; view counts under concurrency |
| Stories with expiry | E | Clock-driven expiry, visibility lists | Expiry without a background job; close-friends lists |

## Infrastructure and frameworks

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Logging framework](../problems/logging-framework.md) | E | Chain of Responsibility, formatter Strategy, the Singleton debate | Level filtering per logger; async appenders losing logs on crash |
| [Pub-sub system](../problems/pub-sub-system.md) | M | Observer, topics, offsets | Delivery guarantees; a slow subscriber holding up others |
| [Rate limiter](../problems/rate-limiter.md) | M | Strategy (token bucket, sliding window), injected clock | Bursts at window edges; atomicity across instances |
| [Notification service](../problems/notification-service.md) | M | Adapter per channel, templates, retries | Duplicate sends on retry; preferences and quiet hours |
| [LRU cache](../problems/lru-cache.md) | M | Hash map plus doubly linked list | O(1) get and put; updating an existing key's position |
| [In-memory file system](../problems/in-memory-file-system.md) | M | Composite, path resolution | Move and rename; deleting non-empty directories |
| [Text editor](../problems/text-editor.md) | H | Command for undo and redo, Memento, text buffer | Discarding the redo stack after a new edit; gap buffer versus piece table |
| Key-value store with TTL and transactions | M | Command, nested transactions | Rolling back nested transactions; lazy versus active expiry |
| Job scheduler | M | Priority queue by next run, Command | Missed runs after downtime; overlapping executions of one job |
| Circuit breaker and retry library | M | [Circuit Breaker](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/modern/circuit-breaker), State, Decorator | Half-open probes under load; retry storms |
| Dependency injection container | H | Registration, lifetimes, cycle detection | Singleton versus scoped lifetimes; circular dependencies |
| Feature flag service | M | Targeting rule Strategy, hashing for rollouts | Stable bucketing per user; rule precedence |
| Middleware pipeline | E | Chain of Responsibility | Error propagation; async `next()` |
| Search autocomplete | M | Trie, top-k per prefix | Keeping top-k current as new queries arrive |
| Mini version control | H | Content-addressed objects, Command | Immutable commits; three-way merge |
| Load balancer | M | Strategy (round robin, least connections), health checks | Removing an unhealthy node with requests in flight |

## Games

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Tic-tac-toe](../problems/tic-tac-toe.md) | E | Board, win detection, game State | O(1) win check with counters; N by N boards |
| [Snake and ladder](../problems/snake-and-ladder.md) | E | Injected dice Strategy, board configuration | Testing randomness deterministically; overshooting the last square |
| [Chess](../problems/chess-game.md) | H | Polymorphic pieces, move validation, Command for history | Check, pins, castling, en passant; legal versus pseudo-legal moves |
| Minesweeper | E | Grid state, flood fill | First click never a mine; recursive reveal |
| Sudoku validator and solver | M | Constraint sets, backtracking | Agreeing whether solving is in scope |
| Connect four | E | Board, win detection | Diagonal checks from the last move only |
| Card games (blackjack, poker) | M | Deck, hand evaluation Strategy | Ace values; ranking ties |
| Battleship | E | Grid, placement validation | Overlaps and bounds |
| Bowling score | E | Frames, bonuses | Bonus rolls in the tenth frame |
| 2048 | E | Grid merge rules | One merge per tile per move |

## Management systems

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Task management](../problems/task-management-system.md) | M | Task State, assignment, Observer, filters | Workflow transitions per project; audit history |
| [Library management](../problems/library-management-system.md) | E | Book versus copy, loans, fine Strategy | Book versus book item; reservation queue on return |
| [Restaurant management](../problems/restaurant-management-system.md) | M | Order State, kitchen queue, billing | Changing an order already sent to the kitchen; splitting a bill |
| [Course registration](../problems/course-registration-system.md) | M | Capacity, prerequisites, waitlist | The last seat race; timetable clashes; waitlist promotion |
| Hospital management | M | Patients, appointments, admissions, billing | Patient versus visit versus admission |
| Leave management | E | Approval Chain of Responsibility, balances | Accrual rules; multi-level approval |
| Learning management system | M | Courses, progress, quizzes | Progress across content types |
| Apartment management | E | Recurring dues, visitor approvals | Penalties on late dues; approval by any resident of a flat |

## Concurrency

These are asked as "implement it thread-safe". In a Node role, answer with promises and say what Java would need; see [concurrency in LLD](concurrency-in-lld.md).

| Question | Level | Tests | Trap or hard part |
|---|---|---|---|
| [Bounded blocking queue](../problems/concurrency-primitives.md) | M | Condition waits, backpressure | Spurious wakeups; waking the right waiter |
| [Producer-consumer](../problems/concurrency-primitives.md) | M | Bounded queue, worker loops | Clean shutdown and draining |
| Reader-writer lock | H | Shared versus exclusive access | Writer starvation |
| Print in order, alternate threads | E | Semaphores, latches | Handing over turns without busy waiting |
| Dining philosophers | M | Deadlock avoidance, lock ordering | Deadlock versus starvation |
| Thread pool | H | Work queue, worker lifecycle, futures | Rejection policy; graceful shutdown |
| Connection pool | M | Semaphore, leases, timeouts | Leaked connections; validating on borrow |
| [Thread-safe LRU cache](../problems/lru-cache.md) | M | Lock granularity, single-flight loading | A read is a write in an LRU; thundering herd on a miss |
| Delayed task scheduler | H | Priority queue plus timed wait | An earlier task arriving while the worker sleeps |
| [Distributed rate limiter](../problems/rate-limiter.md) | H | Atomic check-and-decrement in a shared store | Clock skew between instances; per-instance limits multiplying |

## Who tends to ask what

General guidance only; formats vary by team and change over time.

| Kind of company or team | Round format | Typical prompts |
|---|---|---|
| Product companies with a machine coding round | 90-120 minutes, runnable code, graded on completeness, extensibility and tests | Splitwise, snake and ladder, parking lot, key-value store, cab booking |
| Large tech companies with an object design round | 45-60 minutes, diagram plus partial code, many follow-ups | Elevator, parking lot, LRU cache, file system, chess |
| Payments and fintech | Correctness-heavy; expect money and retries | Wallet, payment gateway, subscription billing, ledgers |
| Platform, infrastructure and developer tools | Library-style APIs and concurrency | Rate limiter, logger, pub-sub, scheduler, cache |
| Marketplaces, travel and ticketing | Holds, inventory and state machines | Movie or concert booking, hotel, food delivery, ride sharing |
| Trading and Java-heavy backends | Threads and locks in depth | Blocking queue, thread pool, reader-writer lock, order book |
| Gaming and consumer apps | Rules modelling and clean game loops | Chess, card games, tic-tac-toe, snake and ladder |
