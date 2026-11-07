import type { Money } from '../shared/money';

/**
 * Divides `total` minor units in proportion to integer `weights` so the parts
 * always add up to `total` exactly (the largest-remainder method). Each part
 * starts at floor(total * weight / sum of weights); the leftover units go one
 * each to the largest remainders, ties to the earlier position. Deterministic:
 * allocateByWeights(100, [1, 1, 1]) is [34, 33, 33].
 */
export function allocateByWeights(total: Money, weights: readonly number[]): Money[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`total must be a non-negative integer, got ${total}`);
  if (weights.length === 0) throw new RangeError('at least one weight is required');
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    throw new RangeError(`weights must be non-negative integers, got ${weights.join(', ')}`);
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) throw new RangeError('weights must not all be zero');

  // total * weight is an exact integer, so floor and % below are exact as well.
  const parts = weights.map((weight) => Math.floor((total * weight) / weightSum));
  let leftover = total - parts.reduce((sum, part) => sum + part, 0);
  const byRemainder = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % weightSum }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; leftover > 0; i += 1, leftover -= 1) parts[byRemainder[i].index] += 1;
  return parts;
}
