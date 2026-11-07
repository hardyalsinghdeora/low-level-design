# SOLID principles

SOLID is five rules for placing responsibilities and dependencies so that a change lands in one class. LLD rounds rarely ask for them by name; they are graded through follow-ups such as "add a new discount" or "swap the payment provider". Each section below has a before/after from a billing or ordering domain, the smell it removes, how it shows up in an interview, and a one-line test you can run on your own design. The building blocks (encapsulation, interfaces, structural typing) are in [OOP fundamentals](oop-fundamentals.md).

Amounts are integers in minor units, as in [`Money`](../src/shared/money.ts).

## S: Single responsibility

A class has one reason to change: one actor or one business rule that can ask for an edit.

**Smell**: finance changes the tax rule, design changes the invoice layout, ops changes storage, and all three edit the same class.

Before:

```ts
interface LineItem { sku: string; unitPrice: number; quantity: number }

export class InvoiceService {
  private readonly documents = new Map<string, string>();

  issue(orderId: string, items: LineItem[], email: string): number {
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const total = subtotal + Math.round(subtotal * 0.18); // tax rule
    const html = `<h1>Invoice ${orderId}</h1><p>${total}</p>`; // layout
    this.documents.set(orderId, html); // storage
    console.log(`mail ${html} to ${email}`); // delivery
    return total;
  }
}
```

After:

```ts
interface LineItem { sku: string; unitPrice: number; quantity: number }
export interface Invoice { orderId: string; subtotal: number; tax: number; total: number }

/** Finance owns this class: totals and tax, in basis points to stay in integers. */
export class InvoiceCalculator {
  constructor(private readonly taxBasisPoints: number) {}

  calculate(orderId: string, items: LineItem[]): Invoice {
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const tax = Math.round((subtotal * this.taxBasisPoints) / 10_000);
    return { orderId, subtotal, tax, total: subtotal + tax };
  }
}

export interface InvoiceRenderer { render(invoice: Invoice): string }
export interface InvoiceRepository { save(invoice: Invoice): void }
export interface InvoiceSender { send(email: string, document: string): void }

/** Orchestrates only; each rule lives in the collaborator that owns it. */
export class InvoiceService {
  constructor(
    private readonly calculator: InvoiceCalculator,
    private readonly renderer: InvoiceRenderer,
    private readonly repository: InvoiceRepository,
    private readonly sender: InvoiceSender,
  ) {}

  issue(orderId: string, items: LineItem[], email: string): Invoice {
    const invoice = this.calculator.calculate(orderId, items);
    this.repository.save(invoice);
    this.sender.send(email, this.renderer.render(invoice));
    return invoice;
  }
}
```

**In interviews**: the violation is the `ParkingLotManager` or `OrderService` with thirty methods while `Order` and `Spot` are bags of fields. The fix moves each rule next to its data (`order.cancel()` validates the transition) and leaves orchestration in the aggregate root. Splitting too far is also a smell: one-method classes with no reason to vary separately.

**One-line test**: list the people who would ask you to change this class; more than one is a violation.

## O: Open/closed

Open for extension, closed for modification: a new variant is a new class, not an edit to working code.

**Smell**: the same `switch` on a type appears in several places, and every new variant edits all of them.

Before:

```ts
type CustomerTier = 'REGULAR' | 'GOLD' | 'EMPLOYEE';

export function discountFor(tier: CustomerTier, subtotal: number): number {
  switch (tier) {
    case 'REGULAR':
      return 0;
    case 'GOLD':
      return Math.round(subtotal * 0.1);
    case 'EMPLOYEE':
      return Math.min(Math.round(subtotal * 0.3), 50_000);
  }
}
```

After:

```ts
export interface OrderContext { customerTier: string; subtotal: number; couponCode?: string }

export interface DiscountPolicy {
  appliesTo(order: OrderContext): boolean;
  discount(order: OrderContext): number;
}

export class TierDiscount implements DiscountPolicy {
  constructor(private readonly tier: string, private readonly basisPoints: number) {}
  appliesTo(order: OrderContext): boolean { return order.customerTier === this.tier; }
  discount(order: OrderContext): number { return Math.round((order.subtotal * this.basisPoints) / 10_000); }
}

export class CouponDiscount implements DiscountPolicy {
  constructor(private readonly code: string, private readonly amount: number) {}
  appliesTo(order: OrderContext): boolean { return order.couponCode === this.code; }
  discount(_order: OrderContext): number { return this.amount; }
}

/** Closed: a new promotion is a new DiscountPolicy passed in at the composition root. */
export class DiscountEngine {
  constructor(private readonly policies: readonly DiscountPolicy[]) {}

  bestDiscount(order: OrderContext): number {
    const amounts = this.policies.filter((p) => p.appliesTo(order)).map((p) => p.discount(order));
    return Math.min(order.subtotal, Math.max(0, ...amounts)); // never below a zero total
  }
}
```

**In interviews**: almost every follow-up tests this ("add EV spots", "add a wallet payment", "weekend pricing"). The answer names the interface that absorbs the change: a [Strategy](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/strategy), a [Decorator](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/decorator) for surcharges, or a [Chain of Responsibility](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/chain-of-responsibility) when several rules apply in order. A class can only be closed against changes you predicted, so abstract the rules the requirements say will vary and leave the rest concrete.

**One-line test**: does adding a variant edit an existing `switch`, `if` chain or enum-keyed branch outside one lookup table?

## L: Liskov substitution

A subtype must work wherever its base type is expected without the caller knowing: it accepts at least the same inputs, guarantees at least the same outputs, and keeps the base type's invariants.

**Smell**: a subclass that throws "not supported", callers that check `instanceof` before calling, or an implementation that accepts narrower input than its interface.

Before (this compiles, because TypeScript checks method parameters bivariantly):

```ts
interface CardPayment { kind: 'CARD'; cardToken: string; amount: number }
interface UpiPayment { kind: 'UPI'; vpa: string; amount: number }
type PaymentRequest = CardPayment | UpiPayment;

interface PaymentProcessor {
  charge(request: PaymentRequest): string;
}

class CardProcessor implements PaymentProcessor {
  charge(request: CardPayment): string { // narrower than the interface promises
    return `charged ${request.amount} to card ending ${request.cardToken.slice(-4)}`;
  }
}

const processor: PaymentProcessor = new CardProcessor();
processor.charge({ kind: 'UPI', vpa: 'asha@bank', amount: 49_900 }); // TypeError at runtime
```

After: make each processor honest about what it accepts, and route in one place the compiler checks.

```ts
interface CardPayment { kind: 'CARD'; cardToken: string; amount: number }
interface UpiPayment { kind: 'UPI'; vpa: string; amount: number }
type PaymentRequest = CardPayment | UpiPayment;
type PaymentKind = PaymentRequest['kind'];

interface PaymentProcessor<R extends PaymentRequest> {
  charge(request: R): string;
}

class CardProcessor implements PaymentProcessor<CardPayment> {
  charge(request: CardPayment): string { return `card ${request.cardToken.slice(-4)}: ${request.amount}`; }
}

class UpiProcessor implements PaymentProcessor<UpiPayment> {
  charge(request: UpiPayment): string { return `upi ${request.vpa}: ${request.amount}`; }
}

/** Adding a kind to PaymentRequest is a compile error here until a processor exists. */
type ProcessorRegistry = { [K in PaymentKind]: PaymentProcessor<Extract<PaymentRequest, { kind: K }>> };

export class PaymentRouter {
  constructor(private readonly processors: ProcessorRegistry) {}

  charge(request: PaymentRequest): string {
    switch (request.kind) {
      case 'CARD':
        return this.processors.CARD.charge(request);
      case 'UPI':
        return this.processors.UPI.charge(request);
    }
  }
}

const router = new PaymentRouter({ CARD: new CardProcessor(), UPI: new UpiProcessor() });
router.charge({ kind: 'UPI', vpa: 'asha@bank', amount: 49_900 });
```

Declaring the interface member as a function-typed property (`charge: (request: PaymentRequest) => string`) also makes `strictFunctionTypes` reject the narrowed parameter, because the stricter check applies to function types and not to method signatures.

The same violation without generics: `PrepaidPlan extends Subscription` and overrides `pause()` to throw. Callers of `Subscription` now need to know which plan they hold. Move pausing to a `Pausable` capability that only pausable plans implement.

**In interviews**: it appears the moment you draw inheritance. `FreeOrder extends Order` with a throwing `refund()`, `Penguin extends Bird`, a chess piece whose `moves()` needs a special case in the board. Prefer composition or a capability interface over a subclass that disables inherited behaviour ([inheritance versus composition](oop-fundamentals.md#inheritance-versus-composition)).

**One-line test**: would any caller of the base type need an `instanceof` check or a `try/catch` for this subtype?

## I: Interface segregation

Clients should not depend on methods they do not call. Many small role interfaces beat one wide one.

**Smell**: implementations that throw "not supported" or leave methods empty to satisfy an interface.

Before:

```ts
interface PaymentGateway {
  charge(orderId: string, amount: number): string;
  refund(chargeId: string, amount: number): void;
  createSubscription(customerId: string, planId: string): string;
  payout(merchantId: string, amount: number): void;
}

class CashOnDeliveryGateway implements PaymentGateway {
  charge(orderId: string, _amount: number): string { return `cod-${orderId}`; }
  refund(): void { throw new Error('COD refunds are manual'); }
  createSubscription(): string { throw new Error('not supported'); }
  payout(): void { throw new Error('not supported'); }
}
```

After:

```ts
export interface Chargeable { charge(orderId: string, amount: number): string }
export interface Refundable { refund(chargeId: string, amount: number): void }
export interface RecurringBilling { createSubscription(customerId: string, planId: string): string }

export class CashOnDeliveryGateway implements Chargeable {
  charge(orderId: string, _amount: number): string { return `cod-${orderId}`; }
}

export class CardGateway implements Chargeable, Refundable, RecurringBilling {
  charge(orderId: string, amount: number): string { return `card-${orderId}-${amount}`; }
  refund(_chargeId: string, _amount: number): void {}
  createSubscription(customerId: string, planId: string): string { return `sub-${customerId}-${planId}`; }
}

/** Depends only on the role it uses, so a test double is one method. */
export class RefundService {
  constructor(private readonly gateway: Refundable) {}
  refund(chargeId: string, amount: number): void { this.gateway.refund(chargeId, amount); }
}
```

**In interviews**: notification channels (`Sms` does not support attachments), payment methods, and storage backends. One nuance: in the [State](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/behavioral/state) pattern every state implements every event (`insertCoin`, `selectItem`, `dispense`) and some throw an invalid-transition error. That is the state machine rejecting an event, not a segregation failure, and you can say so.

**One-line test**: does any implementation throw "not supported" or leave a method body empty?

## D: Dependency inversion

High-level policy depends on abstractions it owns; low-level details (SDKs, databases, the system clock) implement them.

**Smell**: `new VendorClient()` and `new Date()` inside business logic, so the class cannot be tested without the network or the real time.

Before:

```ts
class AcmePayClient {
  createCharge(amount: number, token: string): string { return `ch_${token}_${amount}`; }
}
class SmtpMailer {
  send(_to: string, _body: string): void {}
}

export class CheckoutService {
  private readonly payments = new AcmePayClient();
  private readonly mailer = new SmtpMailer();

  checkout(orderId: string, amount: number, token: string, email: string): string {
    const chargeId = this.payments.createCharge(amount, token);
    this.mailer.send(email, `Order ${orderId} placed at ${new Date().toISOString()}`);
    return chargeId;
  }
}
```

After:

```ts
import { type Clock, SystemClock } from '../src/shared/clock';

export interface PaymentGateway { charge(amount: number, token: string): string }
export interface Notifier { notify(recipient: string, message: string): void }

export class CheckoutService {
  constructor(
    private readonly payments: PaymentGateway,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  checkout(orderId: string, amount: number, token: string, email: string): string {
    const chargeId = this.payments.charge(amount, token);
    this.notifier.notify(email, `Order ${orderId} placed at ${this.clock.now().toISOString()}`);
    return chargeId;
  }
}

class AcmePayClient {
  createCharge(amount: number, token: string): string { return `ch_${token}_${amount}`; }
}

/** Adapter: the vendor detail conforms to our interface, not the other way round. */
class AcmePayGateway implements PaymentGateway {
  constructor(private readonly client: AcmePayClient) {}
  charge(amount: number, token: string): string { return this.client.createCharge(amount, token); }
}

class EmailNotifier implements Notifier {
  notify(_recipient: string, _message: string): void {}
}

// Composition root: the only place that knows the concrete classes.
export const checkout = new CheckoutService(
  new AcmePayGateway(new AcmePayClient()),
  new EmailNotifier(),
  new SystemClock(),
);
```

**In interviews**: injecting `Clock` and `IdGenerator` ([`src/shared/`](../src/shared/)) is the cheapest way to show it, and it makes fee and expiry logic testable with `FakeClock`. It is also the answer to "should `ParkingLot` be a Singleton?": build one instance at the composition root and pass it in. Wrapping a vendor SDK is an [Adapter](https://github.com/hardyalsinghdeora/design-patterns/tree/main/src/structural/adapter).

**One-line test**: can you unit-test this class without a network, a database or the real clock?

## Summary

| Principle | Typical interview question | What a good answer says |
|---|---|---|
| Single responsibility | "Your `OrderService` does a lot. How would you split it?" | Names the actors that change each part; moves rules into the entities that own the data; keeps the service as orchestration |
| Open/closed | "Add a new discount type without touching existing code." | Points to the `DiscountPolicy` interface; the change is one new class and one line of wiring; abstracts only what the requirements say varies |
| Liskov substitution | "Can `FreeOrder` extend `Order`?" | Only if it honours every `Order` contract; a throwing `refund()` means use composition or a capability interface instead |
| Interface segregation | "Cash on delivery cannot refund. What happens to your gateway interface?" | Splits it into `Chargeable` and `Refundable`; services depend on the role they use |
| Dependency inversion | "How would you test checkout without hitting the payment provider?" | The service depends on a `PaymentGateway` interface; an adapter wraps the SDK; tests pass a fake; time comes from an injected `Clock` |

## Related

- [OOP fundamentals](oop-fundamentals.md), [class relationships](class-relationships.md)
- [How to answer an LLD interview](how-to-answer-lld-interview.md)
- [Question bank](question-bank.md)
