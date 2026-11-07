/**
 * A rental branch. Vehicles point at a store by id, so a one-way rental moves a
 * car by updating one field instead of shuffling collections between stores.
 */
export class Store {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly city: string,
  ) {
    if (!id.trim()) throw new RangeError('store id is required');
  }
}
