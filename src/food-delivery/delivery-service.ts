import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import type { DeliveryPartner } from './delivery-partner';
import { InvalidQuantityError, NoPartnerAvailableError, NotFoundError, RestaurantClosedError } from './errors';
import { ActorRole, FoodOrder, FoodOrderStatus, type Actor, type OrderLine } from './food-order';
import { straightLineKm, type DistanceFn, type Location } from './geo';
import type { OrderObserver } from './order-events';
import type { Restaurant } from './restaurant';
import { NearestAvailableDispatch, type DispatchStrategy } from './strategies/dispatch';
import { StateBasedCancellationPolicy, type CancellationPolicy, type DeliveryPricingStrategy } from './strategies/pricing';

export interface FoodDeliveryOptions {
  pricing: DeliveryPricingStrategy;
  dispatch?: DispatchStrategy;
  cancellation?: CancellationPolicy;
  distance?: DistanceFn;
  /** Average rider speed for the ETA. */
  speedKmPerHour?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

export interface OrderRequest {
  customerId: string;
  restaurantId: string;
  items: { itemId: string; quantity: number }[];
  dropOff: Location;
}

/**
 * Application service: validates orders against the restaurant and the clock,
 * prices delivery, dispatches partners and keeps partner availability in step
 * with the order lifecycle.
 */
export class FoodDeliveryService {
  private readonly restaurants = new Map<string, Restaurant>();
  private readonly partners = new Map<string, DeliveryPartner>();
  private readonly orders = new Map<string, FoodOrder>();
  private readonly observers: OrderObserver[] = [];
  private readonly pricing: DeliveryPricingStrategy;
  private dispatchStrategy: DispatchStrategy;
  private readonly cancellation: CancellationPolicy;
  private readonly distance: DistanceFn;
  private readonly speedKmPerHour: number;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: FoodDeliveryOptions) {
    this.pricing = options.pricing;
    this.dispatchStrategy = options.dispatch ?? new NearestAvailableDispatch();
    this.cancellation = options.cancellation ?? new StateBasedCancellationPolicy();
    this.distance = options.distance ?? straightLineKm;
    this.speedKmPerHour = options.speedKmPerHour ?? 20;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addRestaurant(restaurant: Restaurant): this {
    this.restaurants.set(restaurant.id, restaurant);
    return this;
  }

  addPartner(partner: DeliveryPartner): this {
    this.partners.set(partner.id, partner);
    return this;
  }

  setDispatchStrategy(strategy: DispatchStrategy): void {
    this.dispatchStrategy = strategy;
  }

  subscribe(observer: OrderObserver): void {
    this.observers.push(observer);
  }

  placeOrder(request: OrderRequest): FoodOrder {
    const restaurant = this.restaurant(request.restaurantId);
    const now = this.clock.now();
    if (!restaurant.isOpenAt(now)) throw new RestaurantClosedError(restaurant.id, now);
    if (request.items.length === 0) throw new InvalidQuantityError(0);
    const lines: OrderLine[] = request.items.map(({ itemId, quantity }) => {
      if (!Number.isInteger(quantity) || quantity <= 0) throw new InvalidQuantityError(quantity);
      const item = restaurant.orderable(itemId);
      return { itemId, name: item.name, unitPrice: item.price, quantity };
    });
    const itemTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const distanceKm = this.distance(restaurant.location, request.dropOff);
    const fee = this.pricing.fee({ distanceKm, itemTotal, at: now });

    const order = new FoodOrder(this.ids.next('ORD'), request.customerId, restaurant.id, lines, fee, request.dropOff, now);
    this.orders.set(order.id, order);
    this.publish(order);
    return order;
  }

  /** The kitchen accepts; we try to dispatch at once but an order may wait for a partner. */
  accept(orderId: string, by: Actor): FoodOrder {
    const order = this.order(orderId);
    order.transition(FoodOrderStatus.ACCEPTED, by, this.clock.now());
    if (this.findPartnerFor(order)) this.assign(order);
    this.publish(order);
    return order;
  }

  /** Explicit dispatch, e.g. retried by a scheduler for orders still without a partner. */
  dispatch(orderId: string): DeliveryPartner {
    const order = this.order(orderId);
    if (order.partnerId) return this.partner(order.partnerId);
    const partner = this.assign(order);
    this.publish(order);
    return partner;
  }

  startPreparing(orderId: string, by: Actor): FoodOrder {
    return this.move(orderId, FoodOrderStatus.PREPARING, by);
  }

  markReady(orderId: string, by: Actor): FoodOrder {
    return this.move(orderId, FoodOrderStatus.READY_FOR_PICKUP, by);
  }

  pickUp(orderId: string, by: Actor): FoodOrder {
    const order = this.move(orderId, FoodOrderStatus.PICKED_UP, by);
    this.partner(by.id).moveTo(this.restaurant(order.restaurantId).location);
    return order;
  }

  /** Delivery frees the partner at the customer's door, ready for the next dispatch. */
  deliver(orderId: string, by: Actor): FoodOrder {
    const order = this.move(orderId, FoodOrderStatus.DELIVERED, by);
    this.partner(by.id).release(order.dropOff);
    return order;
  }

  /** The fee depends on the state the order was in when cancelled; an assigned partner is freed. */
  cancel(orderId: string, by: Actor): Money {
    const order = this.order(orderId);
    const fee = by.role === ActorRole.CUSTOMER ? this.cancellation.fee(order) : 0;
    order.cancel(by, fee, this.clock.now());
    if (order.partnerId) this.partner(order.partnerId).release();
    this.publish(order);
    return fee;
  }

  /** Minutes until the food arrives: remaining prep, rider to restaurant, restaurant to door. */
  estimateEtaMinutes(orderId: string): number {
    const order = this.order(orderId);
    const restaurant = this.restaurant(order.restaurantId);
    const travel = (km: number) => (km / this.speedKmPerHour) * 60;
    const prepLeft = [FoodOrderStatus.PLACED, FoodOrderStatus.ACCEPTED, FoodOrderStatus.PREPARING].includes(order.status)
      ? restaurant.prepMinutes
      : 0;
    const partner = order.partnerId ? this.partner(order.partnerId) : null;
    const toRestaurant =
      order.status === FoodOrderStatus.PICKED_UP || !partner ? 0 : travel(this.distance(partner.location, restaurant.location));
    const toDoor = travel(this.distance(restaurant.location, order.dropOff));
    return Math.ceil(Math.max(prepLeft, toRestaurant) + toDoor);
  }

  order(orderId: string): FoodOrder {
    const order = this.orders.get(orderId);
    if (!order) throw new NotFoundError('order', orderId);
    return order;
  }

  partner(partnerId: string): DeliveryPartner {
    const partner = this.partners.get(partnerId);
    if (!partner) throw new NotFoundError('partner', partnerId);
    return partner;
  }

  private restaurant(restaurantId: string): Restaurant {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) throw new NotFoundError('restaurant', restaurantId);
    return restaurant;
  }

  private findPartnerFor(order: FoodOrder): DeliveryPartner | null {
    const pickup = this.restaurant(order.restaurantId).location;
    return this.dispatchStrategy.choose([...this.partners.values()], pickup, this.distance);
  }

  private assign(order: FoodOrder): DeliveryPartner {
    const partner = this.findPartnerFor(order);
    if (!partner) throw new NoPartnerAvailableError(order.id);
    partner.assign(order.id); // throws if someone else took the partner meanwhile
    order.assignPartner(partner.id);
    return partner;
  }

  private move(orderId: string, next: FoodOrderStatus, by: Actor): FoodOrder {
    const order = this.order(orderId);
    order.transition(next, by, this.clock.now());
    this.publish(order);
    return order;
  }

  private publish(order: FoodOrder): void {
    const event = {
      orderId: order.id,
      customerId: order.customerId,
      restaurantId: order.restaurantId,
      partnerId: order.partnerId,
      status: order.status,
      at: this.clock.now(),
    };
    for (const observer of this.observers) observer.onStatusChange(event);
  }
}
