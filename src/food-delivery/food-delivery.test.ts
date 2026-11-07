import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  type Actor,
  ActorRole,
  DeliveryPartner,
  DistancePricing,
  FoodDeliveryService,
  FoodOrderStatus,
  InvalidOrderTransitionError,
  InvalidQuantityError,
  manhattanKm,
  MenuItemUnavailableError,
  NearestAvailableDispatch,
  NoPartnerAvailableError,
  OpeningHours,
  PartnerStatus,
  PartnerUnavailableError,
  RatingWeightedDispatch,
  RecordingObserver,
  Restaurant,
  RestaurantClosedError,
  SurgePricing,
  UnauthorizedActorError,
} from './index';

const customer: Actor = { role: ActorRole.CUSTOMER, id: 'cust' };
const kitchen: Actor = { role: ActorRole.RESTAURANT, id: 'R1' };
const rider = (id: string): Actor => ({ role: ActorRole.PARTNER, id });
const DROP = { x: 4, y: 3 }; // 5 km in a straight line from the restaurant

function setup(options: { surge?: number; dispatch?: NearestAvailableDispatch | RatingWeightedDispatch } = {}) {
  const clock = new FakeClock('2026-07-01T12:00:00Z');
  const observer = new RecordingObserver();
  const base = new DistancePricing(2_000, 1_000);
  const service = new FoodDeliveryService({
    pricing: options.surge ? new SurgePricing(base, () => options.surge ?? 100) : base,
    dispatch: options.dispatch,
    clock,
    ids: new SequentialIdGenerator(),
  });
  service.subscribe(observer);
  service.addRestaurant(
    new Restaurant('R1', 'Paradise', { x: 0, y: 0 }, new OpeningHours([{ open: '10:00', close: '23:00' }]))
      .addItem('biryani', 'Chicken Biryani', 25_000)
      .addItem('naan', 'Butter Naan', 4_000),
  );
  const partners = [
    new DeliveryPartner('P1', 'Ravi', { x: 1, y: 0 }, 4.0),
    new DeliveryPartner('P2', 'Meera', { x: 3, y: 0 }, 5.0),
    new DeliveryPartner('P3', 'Kiran', { x: 0.5, y: 0 }, 4.8),
  ];
  for (const p of partners) service.addPartner(p);
  partners[0].goOnline();
  partners[1].goOnline(); // P3 stays offline
  const order = () => service.placeOrder({ customerId: 'cust', restaurantId: 'R1', items: [{ itemId: 'biryani', quantity: 2 }], dropOff: DROP });
  return { clock, observer, service, partners, order };
}

describe('placing orders', () => {
  it('rejects orders while the restaurant is closed, including overnight hours', () => {
    const { clock, order } = setup();
    clock.set('2026-07-01T09:30:00Z');
    expect(order).toThrow(RestaurantClosedError);
    const lateNight = new OpeningHours([{ open: '22:00', close: '02:00' }]);
    expect(lateNight.isOpenAt(new Date('2026-07-01T01:00:00Z'))).toBe(true);
    expect(lateNight.isOpenAt(new Date('2026-07-01T03:00:00Z'))).toBe(false);
  });

  it('rejects sold-out items and bad quantities', () => {
    const { service } = setup();
    const place = (itemId: string, quantity: number) => () =>
      service.placeOrder({ customerId: 'cust', restaurantId: 'R1', items: [{ itemId, quantity }], dropOff: DROP });
    expect(place('pizza', 1)).toThrow(MenuItemUnavailableError);
    expect(place('naan', 0)).toThrow(InvalidQuantityError);
  });

  it('prices delivery by started km, with surge as a decorator rounded up', () => {
    expect(setup().order()).toMatchObject({ itemTotal: 50_000, deliveryFee: 7_000, total: 57_000 });
    expect(setup({ surge: 150 }).order().deliveryFee).toBe(10_500);
    expect(new SurgePricing(new DistancePricing(2_000, 1_000), () => 133).fee({ distanceKm: 0.2, itemTotal: 0, at: new Date() })).toBe(3_990);
    expect(new DistancePricing(2_000, 1_000, 40_000).fee({ distanceKm: 5, itemTotal: 50_000, at: new Date() })).toBe(0);
  });
});

describe('dispatch', () => {
  it('assigns the nearest available partner and marks them busy', () => {
    const { service, partners, order } = setup();
    const first = service.accept(order().id, kitchen);
    expect(first.partnerId).toBe('P1'); // P3 is closer but offline
    expect(partners[0].status).toBe(PartnerStatus.BUSY);
    expect(service.accept(order().id, kitchen).partnerId).toBe('P2');

    const third = service.accept(order().id, kitchen);
    expect(third.partnerId).toBeNull();
    expect(() => service.dispatch(third.id)).toThrow(NoPartnerAvailableError);
    partners[2].goOnline();
    expect(service.dispatch(third.id).id).toBe('P3');
  });

  it('respects the radius and lets the rating-weighted variant prefer a better partner', () => {
    const near = setup({ dispatch: new NearestAvailableDispatch(2) });
    near.partners[0].goOffline();
    expect(near.service.accept(near.order().id, kitchen).partnerId).toBeNull();

    const rated = setup({ dispatch: new RatingWeightedDispatch(5, 3) });
    expect(rated.service.accept(rated.order().id, kitchen).partnerId).toBe('P2');
    const { partners } = setup();
    const choice = new RatingWeightedDispatch(5, 3).choose(partners, { x: 0, y: 0 }, manhattanKm);
    expect(choice?.id).toBe('P2');
  });

  it('keeps a busy partner from going offline or taking a second order', () => {
    const { service, partners, order } = setup();
    service.accept(order().id, kitchen);
    expect(() => partners[0].goOffline()).toThrow(PartnerUnavailableError);
    expect(() => partners[0].assign('ORD-X')).toThrow(PartnerUnavailableError);
    expect(() => partners[2].assign('ORD-X')).toThrow(PartnerUnavailableError); // offline
  });
});

describe('lifecycle', () => {
  it('runs the happy path, frees the partner at the door and notifies every step', () => {
    const { service, partners, order, observer } = setup();
    const { id } = order();
    service.accept(id, kitchen);
    service.startPreparing(id, kitchen);
    service.markReady(id, kitchen);
    service.pickUp(id, rider('P1'));
    service.deliver(id, rider('P1'));

    expect(service.order(id).history.map((h) => h.by)).toEqual(['CUSTOMER', 'RESTAURANT', 'RESTAURANT', 'RESTAURANT', 'PARTNER', 'PARTNER']);
    expect(observer.timeline(id)).toEqual(['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED']);
    expect(partners[0]).toMatchObject({ status: PartnerStatus.AVAILABLE, location: DROP, currentOrderId: null });
  });

  it('rejects illegal transitions and the wrong actor', () => {
    const { service, order } = setup();
    const { id } = order();
    expect(() => service.markReady(id, kitchen)).toThrow(InvalidOrderTransitionError);
    expect(() => service.accept(id, customer)).toThrow(UnauthorizedActorError);
    expect(() => service.accept(id, { role: ActorRole.RESTAURANT, id: 'R2' })).toThrow(UnauthorizedActorError);
    service.accept(id, kitchen);
    service.startPreparing(id, kitchen);
    service.markReady(id, kitchen);
    expect(() => service.pickUp(id, rider('P2'))).toThrow(UnauthorizedActorError);
    service.pickUp(id, rider('P1'));
    expect(() => service.cancel(id, customer)).toThrow(InvalidOrderTransitionError);
    expect(service.order(id).status).toBe(FoodOrderStatus.PICKED_UP);
  });

  it('charges cancellation by state: free before acceptance, 25% once accepted, full once cooking', () => {
    const { service, partners, order } = setup();
    expect(service.cancel(order().id, customer)).toBe(0);

    const accepted = order();
    service.accept(accepted.id, kitchen);
    expect(service.cancel(accepted.id, customer)).toBe(12_500);
    expect(partners[0].status).toBe(PartnerStatus.AVAILABLE);

    const cooking = order();
    service.accept(cooking.id, kitchen);
    service.startPreparing(cooking.id, kitchen);
    expect(service.cancel(cooking.id, customer)).toBe(50_000);
    expect(service.order(cooking.id)).toMatchObject({ status: FoodOrderStatus.CANCELLED, cancellationFee: 50_000 });

    const rejected = order();
    expect(service.cancel(rejected.id, kitchen)).toBe(0); // the restaurant declining never costs the customer
  });

  it('estimates the ETA from prep time, rider approach and the ride to the door', () => {
    const { service, order } = setup();
    const { id } = order();
    service.accept(id, kitchen); // P1 is 3 min away, prep is 15, the ride is 5 km at 20 km/h
    expect(service.estimateEtaMinutes(id)).toBe(30);
    service.startPreparing(id, kitchen);
    service.markReady(id, kitchen);
    service.pickUp(id, rider('P1'));
    expect(service.estimateEtaMinutes(id)).toBe(15);
  });
});
