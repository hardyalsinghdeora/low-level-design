import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { Bill } from './bill';
import {
  InvalidTransitionError,
  MenuItemUnavailableError,
  NoTableAvailableError,
  OrderNotFoundError,
  PaymentMismatchError,
  ReservationNotFoundError,
  TableNotFoundError,
  TableOccupiedError,
  PartyTooLargeError,
  TicketsNotReadyError,
} from './errors';
import { KitchenQueue, type KitchenObserver, type KitchenTicket, TicketStatus } from './kitchen';
import type { Menu } from './menu';
import { Order, type OrderLine, OrderStatus } from './order';
import { RoundRobinAssignment, type Waiter, type WaiterAssignmentStrategy } from './staff';
import { NoServiceCharge, type ServiceChargeStrategy, type TaxStrategy } from './strategies/charges';
import { FifoPrioritisation, type TicketPrioritisationStrategy } from './strategies/kitchen-priority';
import { Reservation, type Table, type TimeSlot } from './table';

export interface RestaurantOptions {
  menu: Menu;
  tax: TaxStrategy;
  serviceCharge?: ServiceChargeStrategy;
  kitchenStrategy?: TicketPrioritisationStrategy;
  waiterAssignment?: WaiterAssignmentStrategy;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root for one restaurant: tables and reservations, orders, the
 * kitchen queue and billing. It is the only place that moves an order through
 * its life while keeping tables, tickets and bills consistent.
 */
export class Restaurant {
  readonly kitchen: KitchenQueue;
  private readonly tables = new Map<string, Table>();
  private readonly waiters: Waiter[] = [];
  private readonly orders = new Map<string, Order>();
  private readonly openOrderByTable = new Map<string, string>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly menu: Menu;
  private readonly tax: TaxStrategy;
  private readonly serviceCharge: ServiceChargeStrategy;
  private readonly waiterAssignment: WaiterAssignmentStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(
    readonly name: string,
    options: RestaurantOptions,
  ) {
    this.menu = options.menu;
    this.tax = options.tax;
    this.serviceCharge = options.serviceCharge ?? new NoServiceCharge();
    this.waiterAssignment = options.waiterAssignment ?? new RoundRobinAssignment();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.kitchen = new KitchenQueue(options.kitchenStrategy ?? new FifoPrioritisation(), this.clock, this.ids);
  }

  addTable(table: Table): this {
    if (this.tables.has(table.id)) throw new RangeError(`Duplicate table ${table.id}`);
    this.tables.set(table.id, table);
    return this;
  }

  addWaiter(waiter: Waiter): this {
    this.waiters.push(waiter);
    return this;
  }

  onTicketReady(observer: KitchenObserver): () => void {
    return this.kitchen.subscribe(observer);
  }

  getTable(tableId: string): Table {
    const table = this.tables.get(tableId);
    if (!table) throw new TableNotFoundError(tableId);
    return table;
  }

  getOrder(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }

  /** Books a specific table; the table itself rejects an overlap. */
  reserveTable(tableId: string, guestName: string, partySize: number, slot: TimeSlot): Reservation {
    const table = this.getTable(tableId);
    const reservation = new Reservation(this.ids.next('RES'), table.id, guestName, partySize, slot);
    table.book(reservation);
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  /** Picks the smallest free table that fits, so a couple never takes the eight-seater. */
  reserve(guestName: string, partySize: number, slot: TimeSlot): Reservation {
    const candidates = [...this.tables.values()]
      .filter((t) => t.fits(partySize) && t.isFreeDuring(slot))
      .sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
    if (candidates.length === 0) throw new NoTableAvailableError(partySize, slot.start);
    return this.reserveTable(candidates[0].id, guestName, partySize, slot);
  }

  cancelReservation(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new ReservationNotFoundError(reservationId);
    reservation.cancel();
  }

  openOrder(tableId: string, partySize: number): Order {
    const table = this.getTable(tableId);
    const existing = this.openOrderByTable.get(table.id);
    if (existing) throw new TableOccupiedError(table.id, existing);
    if (!table.fits(partySize)) throw new PartyTooLargeError(table.id, table.capacity, partySize);
    const waiter = this.waiterAssignment.assign(this.waiters);
    const order = new Order(this.ids.next('ORD'), table.id, waiter.id, partySize, this.clock.now());
    this.orders.set(order.id, order);
    this.openOrderByTable.set(table.id, order.id);
    return order;
  }

  addItem(orderId: string, menuItemId: string, quantity = 1): OrderLine {
    const order = this.getOrder(orderId);
    const item = this.menu.get(menuItemId);
    if (!item.isAvailable) throw new MenuItemUnavailableError(item.name);
    const line: OrderLine = {
      id: this.ids.next('LINE'),
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity,
      station: item.station,
      prepMinutes: item.prepMinutes,
    };
    order.addLine(line);
    return line;
  }

  /** PLACED to IN_KITCHEN, one ticket per line on that line's station. */
  sendToKitchen(orderId: string): KitchenTicket[] {
    const order = this.getOrder(orderId);
    order.moveTo(OrderStatus.IN_KITCHEN);
    return order.lines.map((line) =>
      this.kitchen.submit({
        orderId: order.id,
        tableId: order.tableId,
        waiterId: order.waiterId,
        itemName: line.name,
        quantity: line.quantity,
        station: line.station,
        prepMinutes: line.prepMinutes,
      }),
    );
  }

  serve(orderId: string): Order {
    const order = this.getOrder(orderId);
    const pending = this.kitchen.ticketsFor(order.id).filter((t) => t.status !== TicketStatus.READY).length;
    if (order.status === OrderStatus.IN_KITCHEN && pending > 0) throw new TicketsNotReadyError(order.id, pending);
    order.moveTo(OrderStatus.SERVED);
    return order;
  }

  cancel(orderId: string): Order {
    const order = this.getOrder(orderId);
    order.moveTo(OrderStatus.CANCELLED);
    this.openOrderByTable.delete(order.tableId);
    return order;
  }

  bill(orderId: string): Bill {
    const order = this.getOrder(orderId);
    if (order.status !== OrderStatus.SERVED) throw new InvalidTransitionError('Order', order.id, order.status, 'be billed');
    return Bill.for(order, this.tax, this.serviceCharge);
  }

  /** Settles the full amount (the total of all split shares) and frees the table. */
  pay(orderId: string, amount: Money): Bill {
    const bill = this.bill(orderId);
    if (amount !== bill.total) throw new PaymentMismatchError(orderId, bill.total, amount);
    const order = this.getOrder(orderId);
    order.moveTo(OrderStatus.PAID);
    this.openOrderByTable.delete(order.tableId);
    return bill;
  }
}
