import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  allocate, EmptyOrderError, FifoPrioritisation, InvalidTransitionError, LargePartyServiceCharge, Menu, MenuCategory,
  MenuItem, MenuItemNotFoundError, MenuItemUnavailableError, NoTableAvailableError, NoTax, NothingToCookError,
  NoWaiterOnDutyError, OrderStatus, PartyTooLargeError, PaymentMismatchError, PercentageServiceCharge, PercentageTax,
  ReservationConflictError, Restaurant, type RestaurantOptions, ShortestPrepFirstPrioritisation, slotOf,
  SplitMismatchError, Station, Table, TableOccupiedError, TicketsNotReadyError, TicketStatus, Waiter, WaiterPager,
} from './index';

const at = (hhmm: string): Date => new Date(`2026-05-08T${hhmm}:00Z`);

describe('Restaurant', () => {
  let clock: FakeClock;
  let menu: Menu;
  let restaurant: Restaurant;

  function build(overrides: Partial<RestaurantOptions> = {}): Restaurant {
    const r = new Restaurant('Test', {
      menu,
      tax: new PercentageTax(500),
      serviceCharge: new PercentageServiceCharge(1_000),
      clock,
      ids: new SequentialIdGenerator(),
      ...overrides,
    });
    r.addTable(new Table('T1', 2)).addTable(new Table('T2', 4)).addTable(new Table('T3', 8));
    r.addWaiter(new Waiter('w1', 'Ravi')).addWaiter(new Waiter('w2', 'Meera'));
    return r;
  }

  /** paneer x1 (32500) + fries x2 (29800) + soda x3 (29700) = 92000 subtotal. */
  function servedOrder(r: Restaurant) {
    const order = r.openOrder('T2', 3);
    const lines = [r.addItem(order.id, 'paneer'), r.addItem(order.id, 'fries', 2), r.addItem(order.id, 'soda', 3)];
    for (const ticket of r.sendToKitchen(order.id)) {
      r.kitchen.next(ticket.station);
      r.kitchen.markReady(ticket.id);
    }
    r.serve(order.id);
    return { order, lines };
  }

  beforeEach(() => {
    clock = new FakeClock('2026-05-08T18:00:00Z');
    menu = new Menu()
      .add(new MenuItem('paneer', 'Paneer Tikka', MenuCategory.STARTER, 32_500, Station.GRILL, 15))
      .add(new MenuItem('lamb', 'Lamb Seekh', MenuCategory.MAIN, 45_000, Station.GRILL, 20))
      .add(new MenuItem('corn', 'Corn Skewer', MenuCategory.STARTER, 18_000, Station.GRILL, 8))
      .add(new MenuItem('fries', 'Masala Fries', MenuCategory.STARTER, 14_900, Station.FRY, 6))
      .add(new MenuItem('soda', 'Lime Soda', MenuCategory.DRINK, 9_900, Station.BAR, 2));
    restaurant = build();
  });

  it('treats reservation slots as half-open: back to back is fine, overlap is rejected', () => {
    restaurant.reserveTable('T2', 'Iyer', 4, slotOf(at('19:00'), 120));
    expect(restaurant.reserveTable('T2', 'Khan', 4, slotOf(at('21:00'), 60)).tableId).toBe('T2');
    expect(() => restaurant.reserveTable('T2', 'Rao', 2, slotOf(at('20:59'), 30))).toThrow(ReservationConflictError);
    expect(() => restaurant.reserveTable('T1', 'Big', 5, slotOf(at('19:00'), 60))).toThrow(PartyTooLargeError);
  });

  it('picks the smallest free table and frees the slot on cancellation', () => {
    const slot = slotOf(at('19:00'), 90);
    const first = restaurant.reserve('A', 3, slot);
    expect(first.tableId).toBe('T2');
    expect(restaurant.reserve('B', 3, slot).tableId).toBe('T3');
    expect(() => restaurant.reserve('C', 3, slot)).toThrow(NoTableAvailableError);
    restaurant.cancelReservation(first.id);
    expect(restaurant.reserve('C', 3, slot).tableId).toBe('T2');
    expect(() => restaurant.cancelReservation(first.id)).toThrow(InvalidTransitionError);
  });

  it('honours menu availability toggles', () => {
    menu.setAvailability('lamb', false);
    expect(menu.byCategory(MenuCategory.MAIN)).toEqual([]);
    expect(menu.byCategory(MenuCategory.MAIN, false).map((i) => i.id)).toEqual(['lamb']);
    const order = restaurant.openOrder('T1', 2);
    expect(() => restaurant.addItem(order.id, 'lamb')).toThrow(MenuItemUnavailableError);
    expect(() => restaurant.addItem(order.id, 'caviar')).toThrow(MenuItemNotFoundError);
  });

  it('moves an order PLACED -> IN_KITCHEN -> SERVED -> PAID and guards each step', () => {
    const order = restaurant.openOrder('T2', 2);
    expect(() => restaurant.sendToKitchen(order.id)).toThrow(EmptyOrderError);
    restaurant.addItem(order.id, 'fries');
    const [ticket] = restaurant.sendToKitchen(order.id);
    expect(order.status).toBe(OrderStatus.IN_KITCHEN);
    expect(() => restaurant.addItem(order.id, 'soda')).toThrow(InvalidTransitionError);
    expect(() => restaurant.cancel(order.id)).toThrow(InvalidTransitionError);
    expect(() => restaurant.serve(order.id)).toThrow(TicketsNotReadyError);
    expect(() => restaurant.bill(order.id)).toThrow(InvalidTransitionError);

    restaurant.kitchen.next(Station.FRY);
    restaurant.kitchen.markReady(ticket.id);
    restaurant.serve(order.id);
    const bill = restaurant.bill(order.id);
    expect(() => restaurant.pay(order.id, bill.total - 1)).toThrow(PaymentMismatchError);
    restaurant.pay(order.id, bill.total);
    expect(order.status).toBe(OrderStatus.PAID);
    expect(restaurant.openOrder('T2', 2).status).toBe(OrderStatus.PLACED); // table freed
  });

  it('allows one open order per table, and cancelling a placed order frees it', () => {
    const order = restaurant.openOrder('T1', 2);
    expect(() => restaurant.openOrder('T1', 1)).toThrow(TableOccupiedError);
    restaurant.cancel(order.id);
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(restaurant.openOrder('T1', 1).tableId).toBe('T1');
  });

  it('assigns waiters round robin and fails with nobody on duty', () => {
    const waiters = ['T1', 'T2', 'T3'].map((t) => restaurant.openOrder(t, 1).waiterId);
    expect(waiters).toEqual(['w1', 'w2', 'w1']);
    const empty = new Restaurant('Empty', { menu, tax: new NoTax(), clock });
    empty.addTable(new Table('X', 2));
    expect(() => empty.openOrder('X', 2)).toThrow(NoWaiterOnDutyError);
  });

  it('kitchen: FIFO cooks in arrival order, shortest-prep-first picks the quickest dish', () => {
    const order = restaurant.openOrder('T3', 4);
    for (const id of ['lamb', 'paneer', 'corn', 'soda']) restaurant.addItem(order.id, id);
    restaurant.sendToKitchen(order.id);
    expect(restaurant.kitchen.next(Station.GRILL).itemName).toBe('Lamb Seekh');
    restaurant.kitchen.setStrategy(new ShortestPrepFirstPrioritisation());
    expect(restaurant.kitchen.next(Station.GRILL).itemName).toBe('Corn Skewer');
    restaurant.kitchen.setStrategy(new FifoPrioritisation());
    expect(restaurant.kitchen.next(Station.GRILL).itemName).toBe('Paneer Tikka');
    expect(() => restaurant.kitchen.next(Station.GRILL)).toThrow(NothingToCookError);
    expect(restaurant.kitchen.next(Station.BAR).itemName).toBe('Lime Soda'); // stations are independent
  });

  it('pages the order waiter when a ticket is ready, and rejects ready before cooking', () => {
    const pager = new WaiterPager();
    restaurant.onTicketReady(pager);
    const order = restaurant.openOrder('T2', 2);
    restaurant.addItem(order.id, 'fries', 2);
    const [ticket] = restaurant.sendToKitchen(order.id);
    expect(() => restaurant.kitchen.markReady(ticket.id)).toThrow(InvalidTransitionError);
    restaurant.kitchen.next(Station.FRY);
    clock.advanceMinutes(6);
    restaurant.kitchen.markReady(ticket.id);
    expect(ticket.status).toBe(TicketStatus.READY);
    expect(ticket.readyAt?.toISOString()).toBe('2026-05-08T18:06:00.000Z');
    expect(pager.for(order.waiterId)).toEqual(['Table T2: 2 x Masala Fries ready']);
  });

  it('computes service on the subtotal and tax on subtotal plus service, in paise', () => {
    const { order } = servedOrder(restaurant);
    const bill = restaurant.bill(order.id);
    expect(bill.subtotal).toBe(92_000);
    expect(bill.serviceCharge).toBe(9_200);
    expect(bill.tax).toBe(5_060);
    expect(bill.total).toBe(106_260);
  });

  it('service charge strategy variants: large parties only, or none', () => {
    const r = build({ serviceCharge: new LargePartyServiceCharge(1_000, 6), tax: new NoTax() });
    const { order } = servedOrder(r); // party of 3
    expect(r.bill(order.id).total).toBe(92_000);
  });

  it('splits equally with the leftover paise allocated explicitly', () => {
    const { order } = servedOrder(restaurant);
    const shares = restaurant.bill(order.id).splitEqually(8);
    expect(shares).toEqual([13_283, 13_283, 13_283, 13_283, 13_282, 13_282, 13_282, 13_282]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(106_260);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('splits by item with service and tax shared in proportion, and rejects bad claims', () => {
    const { order, lines } = servedOrder(restaurant);
    const bill = restaurant.bill(order.id);
    const [paneer, fries, soda] = lines.map((l) => l.id);
    expect(bill.splitByItems({ anu: [paneer], dev: [fries, soda] })).toEqual({ anu: 37_538, dev: 68_722 });
    expect(() => bill.splitByItems({ anu: [paneer], dev: [fries] })).toThrow(SplitMismatchError);
    expect(() => bill.splitByItems({ anu: [paneer, fries], dev: [fries, soda] })).toThrow(SplitMismatchError);
  });
});
