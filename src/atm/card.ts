/** The plastic: identity and expiry only. The PIN lives with the bank, never on the card or in the ATM. */
export class Card {
  constructor(
    readonly number: string,
    readonly holderName: string,
    readonly expiresAt: Date,
  ) {}

  isExpired(at: Date): boolean {
    return at.getTime() >= this.expiresAt.getTime();
  }

  get masked(): string {
    return `**** ${this.number.slice(-4)}`;
  }
}
