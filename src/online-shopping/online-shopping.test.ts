import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  allocateProportionally,
  CashOnDelivery,
  CouponNotApplicableError,
  CouponNotFoundError,
  CouponStackingError,
  EmptyCartError,
  FakeCardPayment,
  FlatOffCoupon,
  HasTag,
  IdempotencyKeyReusedError,
  InCategory,
  InMemoryOrderNotifier,
  InStock,
  InsufficientStockError,
  InvalidOrderTransitionError,
  InvalidQuantityError,
  NameContains,
  OnlineShop,
  OrderStatus,
  PaymentDeclinedError,
  PercentOffCoupon,
  PriceBetween,
  Product,
  ReturnWindowExpiredError,
  UpiPayment,
} from './index';

function setup() {
  const clock = new FakeClock('2026-06-01T10:00:00Z');
  const notifier = new InMemoryOrderNotifier();
  const shop = new OnlineShop({ clock, ids: new SequentialIdGenerator() });
  shop.subscribe(notifier);
  shop.catalog
    .add(new Product('phone', 'Pixel Phone', 'electronics', 1_500_000, ['5g']))
    .add(new Product('case', 'Phone Case', 'accessories', 99_900))
    .add(new Product('charger', 'Fast Charger', 'accessories', 149_900, ['5g']));
  shop.inventory.restock('phone', 2);
  shop.inventory.restock('case', 10);
  shop.inventory.restock('charger', 1);
  shop.registerCoupon(new FlatOffCoupon('FLAT500', 50_000, { minSubtotal: 200_000 }));
  shop.registerCoupon(new PercentOffCoupon('TEN', 10, { maxDiscount: 100_000 }));
  shop.registerCoupon(new PercentOffCoupon('VIP30', 30, { stackable: false }));
  return { clock, notifier, shop };
}

describe('catalog and cart', () => {
  it('searches with composable specifications, including live stock', () => {
    const { shop } = setup();
    const names = (spec: Parameters<typeof shop.catalog.search>[0]) => shop.catalog.search(spec).map((p) => p.id);
    expect(names(new InCategory('accessories'))).toEqual(['case', 'charger']);
    expect(names(new HasTag('5g').and(new PriceBetween(0, 200_000)))).toEqual(['charger']);
    expect(names(new NameContains('phone').and(new InCategory('accessories').not()))).toEqual(['phone']);
    shop.inventory.reserve([{ productId: 'charger', quantity: 1 }]);
    expect(names(new InCategory('accessories').and(new InStock(shop.inventory)))).toEqual(['case']);
  });

  it('merges repeated adds and keeps the price snapshot after a reprice', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'case', 1);
    shop.catalog.get('case').reprice(129_900);
    const cart = shop.addToCart('asha', 'case', 2);
    expect(cart.lines).toEqual([{ productId: 'case', name: 'Phone Case', unitPrice: 99_900, quantity: 3 }]);
    expect(cart.subtotal).toBe(299_700);
    expect(() => shop.addToCart('asha', 'case', 0)).toThrow(InvalidQuantityError);
  });
});

describe('placing orders', () => {
  it('reserves stock at placement and commits it at payment', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'phone', 1);
    const order = shop.placeOrder('asha', { idempotencyKey: 'k1' });
    expect(order.status).toBe(OrderStatus.PLACED);
    expect(shop.inventory.levelOf('phone')).toEqual({ onHand: 2, reserved: 1 });
    expect(shop.cartOf('asha').isEmpty).toBe(true);

    shop.pay(order.id, new FakeCardPayment('4242'));
    expect(shop.inventory.levelOf('phone')).toEqual({ onHand: 1, reserved: 0 });
    expect(order.amountCollected).toBe(1_500_000);
  });

  it('never oversells: a second order for the last unit fails and reserves nothing', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'charger', 1);
    shop.placeOrder('asha', { idempotencyKey: 'a' });
    shop.addToCart('ben', 'case', 2);
    shop.addToCart('ben', 'charger', 1);
    expect(() => shop.placeOrder('ben', { idempotencyKey: 'b' })).toThrow(InsufficientStockError);
    expect(shop.inventory.levelOf('case').reserved).toBe(0); // all or nothing
    expect(shop.cartOf('ben').lines).toHaveLength(2);
    expect(() => shop.placeOrder('carl', { idempotencyKey: 'c' })).toThrow(EmptyCartError);
  });

  it('is idempotent: the same key returns the same order without reserving twice', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'phone', 1);
    const first = shop.placeOrder('asha', { idempotencyKey: 'retry-me' });
    const again = shop.placeOrder('asha', { idempotencyKey: 'retry-me' });
    expect(again).toBe(first);
    expect(shop.inventory.levelOf('phone').reserved).toBe(1);
    expect(() => shop.placeOrder('asha', { idempotencyKey: 'retry-me', couponCodes: ['TEN'] })).toThrow(IdempotencyKeyReusedError);
  });
});

describe('coupons', () => {
  it('stacks flat before percent and spreads the discount across lines exactly', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'phone', 1);
    shop.addToCart('asha', 'case', 1);
    const order = shop.placeOrder('asha', { idempotencyKey: 'k', couponCodes: ['TEN', 'FLAT500'] });
    // 15,999 - 500 = 15,499, then 10% = 1,549.90 capped at 1,000
    expect(order.coupons).toEqual([
      { code: 'FLAT500', discount: 50_000 },
      { code: 'TEN', discount: 100_000 },
    ]);
    expect(order.total).toBe(1_599_900 - 150_000);
    expect(order.lines.reduce((sum, l) => sum + l.discountShare, 0)).toBe(150_000);
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('enforces stacking rules, thresholds and unknown codes', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'case', 1);
    const place = (couponCodes: string[]) => () => shop.placeOrder('asha', { idempotencyKey: couponCodes.join(), couponCodes });
    expect(place(['VIP30', 'TEN'])).toThrow(CouponStackingError);
    expect(place(['TEN', 'TEN'])).toThrow(CouponStackingError);
    expect(place(['FLAT500'])).toThrow(CouponNotApplicableError);
    expect(place(['NOPE'])).toThrow(CouponNotFoundError);
    expect(shop.inventory.levelOf('case').reserved).toBe(0);
    expect(shop.placeOrder('asha', { idempotencyKey: 'vip', couponCodes: ['VIP30'] }).total).toBe(69_930);
  });
});

describe('payment and lifecycle', () => {
  it('keeps the reservation on a declined card so another method can succeed', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'phone', 1);
    const order = shop.placeOrder('asha', { idempotencyKey: 'k' });
    expect(() => shop.pay(order.id, new FakeCardPayment('0002', () => false))).toThrow(PaymentDeclinedError);
    expect(order.status).toBe(OrderStatus.PLACED);
    expect(shop.inventory.levelOf('phone').reserved).toBe(1);
    expect(() => shop.pay(order.id, new UpiPayment('not-an-id'))).toThrow(PaymentDeclinedError);
    expect(shop.pay(order.id, new UpiPayment('asha@okbank')).payment?.reference).toBe('PAY-4');
  });

  it('caps cash on delivery and collects it at the door', () => {
    const { shop } = setup();
    shop.addToCart('asha', 'phone', 1);
    const big = shop.placeOrder('asha', { idempotencyKey: 'big' });
    expect(() => shop.pay(big.id, new CashOnDelivery(500_000))).toThrow(PaymentDeclinedError);
    shop.addToCart('asha', 'case', 1);
    const small = shop.placeOrder('asha', { idempotencyKey: 'small' });
    shop.pay(small.id, new CashOnDelivery(500_000));
    expect(small.amountCollected).toBe(0);
    shop.ship(small.id);
    shop.deliver(small.id);
    expect(small.amountCollected).toBe(99_900);
  });

  it('validates transitions and the return window', () => {
    const { shop, clock } = setup();
    shop.addToCart('asha', 'case', 2);
    const order = shop.placeOrder('asha', { idempotencyKey: 'k' });
    expect(() => shop.ship(order.id)).toThrow(InvalidOrderTransitionError);
    shop.pay(order.id, new FakeCardPayment('4242'));
    expect(() => shop.pay(order.id, new FakeCardPayment('4242'))).toThrow(InvalidOrderTransitionError);
    shop.ship(order.id);
    expect(() => shop.cancel(order.id)).toThrow(InvalidOrderTransitionError);
    shop.deliver(order.id);
    clock.advanceHours(24 * 3);
    shop.returnOrder(order.id);
    expect(order.history.map((h) => h.status)).toEqual(['PLACED', 'PAID', 'SHIPPED', 'DELIVERED', 'RETURNED']);
    expect(shop.inventory.levelOf('case')).toEqual({ onHand: 10, reserved: 0 });

    shop.addToCart('asha', 'case', 1);
    const late = shop.placeOrder('asha', { idempotencyKey: 'late' });
    shop.pay(late.id, new FakeCardPayment('4242'));
    shop.ship(late.id);
    shop.deliver(late.id);
    clock.advanceHours(24 * 8);
    expect(() => shop.returnOrder(late.id)).toThrow(ReturnWindowExpiredError);
  });

  it('cancellation releases a reservation, or restocks and refunds a paid order', () => {
    const { shop, notifier } = setup();
    shop.addToCart('asha', 'phone', 2);
    const unpaid = shop.placeOrder('asha', { idempotencyKey: 'u' });
    shop.cancel(unpaid.id);
    expect(shop.inventory.levelOf('phone')).toEqual({ onHand: 2, reserved: 0 });

    shop.addToCart('asha', 'charger', 1);
    const paid = shop.placeOrder('asha', { idempotencyKey: 'p' });
    shop.pay(paid.id, new FakeCardPayment('4242'));
    shop.cancel(paid.id);
    expect(shop.inventory.levelOf('charger')).toEqual({ onHand: 1, reserved: 0 });
    expect(notifier.inbox('asha')).toEqual(['ORD-1 PLACED', 'ORD-1 CANCELLED', 'ORD-2 PLACED', 'ORD-2 PAID', 'ORD-2 CANCELLED, refund ₹1,499.00']);
  });
});
