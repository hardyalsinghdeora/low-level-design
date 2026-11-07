import type { Money } from '../shared/money';
import { InvalidAmountError, InvalidSettlementError } from './errors';

/** A real-world payment ("Dev paid Asha Rs 500") that reduces what Dev owes. */
export class Settlement {
  constructor(
    readonly id: string,
    readonly from: string,
    readonly to: string,
    readonly amount: Money,
    readonly groupId: string | undefined,
    readonly paidAt: Date,
  ) {
    if (!Number.isInteger(amount) || amount <= 0) throw new InvalidAmountError(amount);
    if (from === to) throw new InvalidSettlementError(`${from} cannot settle with themselves`);
  }
}
