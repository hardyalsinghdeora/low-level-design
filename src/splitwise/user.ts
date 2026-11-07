/** A person who pays for and shares expenses. Identity only: what they owe is always derived. */
export class User {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    if (!name.trim()) throw new RangeError('name is required');
  }
}
