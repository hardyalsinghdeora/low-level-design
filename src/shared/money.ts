/**
 * Money is always an integer number of minor units (paise, cents).
 * Floating point is never used for amounts: 0.1 + 0.2 !== 0.3.
 */
export type Money = number;

export function formatMoney(amountMinor: Money, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amountMinor / 100);
}

export function assertMoney(amount: Money, label = 'amount'): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`${label} must be a non-negative integer in minor units, got ${amount}`);
  }
}
