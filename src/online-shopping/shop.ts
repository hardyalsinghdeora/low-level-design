import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { Cart } from './cart';
import { CouponNotFoundError, EmptyCartError, IdempotencyKeyReusedError, OrderNotFoundError } from './errors';
import { Inventory, type StockRequest } from './inventory';
import { Order, OrderStatus } from './order';
import type { OrderObserver } from './order-events';
import { Catalog } from './product';
import { CouponStack, type Coupon } from './strategies/coupon';
import type { PaymentStrategy } from './strategies/payment';

export interface OnlineShopOptions {
  clock?: Clock;
  ids?: IdGenerator;
  couponStack?: CouponStack;
  returnWindowDays?: number;
}

export interface PlaceOrderInput {
  /** Client-generated; a retry with the same key returns the first order instead of reserving twice. */
  idempotencyKey: string;
  couponCodes?: string[];
}

/**
 * Application service. It is the only place that touches carts, inventory and
 * orders together, so the reserve / commit / release rules live in one file.
 */
export class OnlineShop {
  readonly catalog = new Catalog();
  readonly inventory = new Inventory();
  private readonly carts = new Map<string, Cart>();
  private readonly orders = new Map<string, Order>();
  private readonly coupons = new Map<string, Coupon>();
  private readonly idempotency = new Map<string, { fingerprint: string; orderId: string }>();
  private readonly observers: OrderObserver[] = [];
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly couponStack: CouponStack;
  private readonly returnWindowDays: number;

  constructor(options: OnlineShopOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.couponStack = options.couponStack ?? new CouponStack();
    this.returnWindowDays = options.returnWindowDays ?? 7;
  }

  subscribe(observer: OrderObserver): void {
    this.observers.push(observer);
  }

  registerCoupon(coupon: Coupon): void {
    this.coupons.set(coupon.code, coupon);
  }

  cartOf(customerId: string): Cart {
    let cart = this.carts.get(customerId);
    if (!cart) {
      cart = new Cart(customerId);
      this.carts.set(customerId, cart);
    }
    return cart;
  }

  addToCart(customerId: string, productId: string, quantity = 1): Cart {
    const cart = this.cartOf(customerId);
    cart.add(this.catalog.get(productId), quantity);
    return cart;
  }

  /** Prices the cart, reserves every line (all or nothing), creates the order and empties the cart. */
  placeOrder(customerId: string, input: PlaceOrderInput): Order {
    const scopedKey = `${customerId}:${input.idempotencyKey}`;
    const previous = this.idempotency.get(scopedKey);
    if (previous) {
      // The cart is server state and was emptied by the first call; the request body is the coupon list.
      if (previous.fingerprint !== fingerprint(input)) throw new IdempotencyKeyReusedError(input.idempotencyKey);
      return this.getOrder(previous.orderId);
    }
    const cart = this.cartOf(customerId);
    if (cart.isEmpty) throw new EmptyCartError(customerId);

    const coupons = (input.couponCodes ?? []).map((code) => {
      const coupon = this.coupons.get(code);
      if (!coupon) throw new CouponNotFoundError(code);
      return coupon;
    });
    const applied = this.couponStack.apply(cart.subtotal, coupons);
    this.inventory.reserve(cart.lines);

    const order = new Order(this.ids.next('ORD'), customerId, cart.lines, applied, this.clock.now());
    this.orders.set(order.id, order);
    this.idempotency.set(scopedKey, { fingerprint: fingerprint(input), orderId: order.id });
    cart.clear();
    this.publish(order);
    return order;
  }

  /** A decline leaves the order PLACED with its stock still reserved, so the customer can retry another method. */
  pay(orderId: string, method: PaymentStrategy): Order {
    const order = this.getOrder(orderId);
    order.assertCanMoveTo(OrderStatus.PAID); // fail before charging, not after
    const receipt = method.pay({ orderId, amount: order.total, reference: this.ids.next('PAY') });
    order.markPaid(receipt, this.clock.now());
    this.inventory.commit(stockOf(order));
    this.publish(order);
    return order;
  }

  ship(orderId: string): Order {
    const order = this.getOrder(orderId);
    order.markShipped(this.clock.now());
    this.publish(order);
    return order;
  }

  deliver(orderId: string): Order {
    const order = this.getOrder(orderId);
    order.markDelivered(this.clock.now());
    this.publish(order);
    return order;
  }

  /** Before payment the reservation is released; after payment the committed stock goes back on the shelf. */
  cancel(orderId: string): Order {
    const order = this.getOrder(orderId);
    const wasPaid = order.status === OrderStatus.PAID;
    const refund = order.cancel(this.clock.now());
    if (wasPaid) for (const line of stockOf(order)) this.inventory.restock(line.productId, line.quantity);
    else this.inventory.release(stockOf(order));
    this.publish(order, refund);
    return order;
  }

  returnOrder(orderId: string): Order {
    const order = this.getOrder(orderId);
    const refund = order.markReturned(this.clock.now(), this.returnWindowDays);
    for (const line of stockOf(order)) this.inventory.restock(line.productId, line.quantity);
    this.publish(order, refund);
    return order;
  }

  getOrder(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }

  private publish(order: Order, refundDue = 0): void {
    const event = { orderId: order.id, customerId: order.customerId, status: order.status, at: this.clock.now(), total: order.total, refundDue };
    for (const observer of this.observers) observer.onOrderEvent(event);
  }
}

function stockOf(order: Order): StockRequest[] {
  return order.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
}

function fingerprint(input: PlaceOrderInput): string {
  return JSON.stringify([...(input.couponCodes ?? [])].sort());
}
