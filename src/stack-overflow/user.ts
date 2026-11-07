/**
 * A member of the site. Reputation only moves through listeners reacting to
 * domain events (see listeners/), never through the service, so every rule
 * that changes reputation lives in one place.
 */
export class User {
  private _reputation: number;
  private readonly _badges = new Set<string>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly isModerator = false,
    startingReputation = 1,
  ) {
    if (!name.trim()) throw new RangeError('name is required');
    this._reputation = startingReputation;
  }

  get reputation(): number {
    return this._reputation;
  }

  get badges(): string[] {
    return [...this._badges];
  }

  /**
   * Deliberately not clamped at 1 like the real site: clamping makes a vote
   * followed by its retraction non-reversible. See problems/stack-overflow.md.
   */
  adjustReputation(delta: number): void {
    if (!Number.isInteger(delta)) throw new RangeError(`reputation delta must be an integer, got ${delta}`);
    this._reputation += delta;
  }

  /** Returns false when the badge is already held, which keeps badge listeners idempotent. */
  awardBadge(badge: string): boolean {
    if (this._badges.has(badge)) return false;
    this._badges.add(badge);
    return true;
  }
}
