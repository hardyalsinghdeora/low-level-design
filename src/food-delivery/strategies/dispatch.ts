import type { DeliveryPartner } from '../delivery-partner';
import type { DistanceFn, Location } from '../geo';

/** Strategy: which available partner should take an order waiting at `pickup`. */
export interface DispatchStrategy {
  choose(partners: readonly DeliveryPartner[], pickup: Location, distance: DistanceFn): DeliveryPartner | null;
}

function candidates(partners: readonly DeliveryPartner[], pickup: Location, distance: DistanceFn, radiusKm: number) {
  return partners
    .filter((p) => p.isAvailable)
    .map((partner) => ({ partner, km: distance(partner.location, pickup) }))
    .filter((c) => c.km <= radiusKm);
}

/** Closest available partner inside the radius; ties go to the lower id so results are stable. */
export class NearestAvailableDispatch implements DispatchStrategy {
  constructor(private readonly radiusKm = 5) {}

  choose(partners: readonly DeliveryPartner[], pickup: Location, distance: DistanceFn): DeliveryPartner | null {
    const ranked = candidates(partners, pickup, distance, this.radiusKm).sort(
      (a, b) => a.km - b.km || a.partner.id.localeCompare(b.partner.id),
    );
    return ranked[0]?.partner ?? null;
  }
}

/**
 * Trades distance for quality: each rating star above 3 is worth `kmPerStar`
 * of extra distance. Lowest score wins.
 */
export class RatingWeightedDispatch implements DispatchStrategy {
  constructor(
    private readonly radiusKm = 5,
    private readonly kmPerStar = 1,
  ) {}

  choose(partners: readonly DeliveryPartner[], pickup: Location, distance: DistanceFn): DeliveryPartner | null {
    const score = (km: number, rating: number) => km - (rating - 3) * this.kmPerStar;
    const ranked = candidates(partners, pickup, distance, this.radiusKm).sort(
      (a, b) => score(a.km, a.partner.rating) - score(b.km, b.partner.rating) || a.partner.id.localeCompare(b.partner.id),
    );
    return ranked[0]?.partner ?? null;
  }
}
