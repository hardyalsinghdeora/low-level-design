import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AccountType,
  BANK_CLEARING_ACCOUNT_ID,
  DailyLimitExceededError,
  EntryDirection,
  FEES_ACCOUNT_ID,
  IdempotencyKeyReusedError,
  InsufficientBalanceError,
  InvalidAmountError,
  InvalidTransactionStateError,
  Ledger,
  LedgerIntegrityError,
  PercentageFeePolicy,
  SameWalletTransferError,
  TieredDailyLimitPolicy,
  Transaction,
  TransactionNotReversibleError,
  TransactionStatus,
  TransactionType,
  UnbalancedPostingError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
  WalletService,
} from './index';

function buildService() {
  const clock = new FakeClock('2026-03-01T09:00:00Z');
  const limitPolicy = new TieredDailyLimitPolicy({ [TransactionType.WITHDRAWAL]: 500_000 });
  const service = new WalletService({
    clock,
    ids: new SequentialIdGenerator(),
    feePolicy: new PercentageFeePolicy(100, [TransactionType.TRANSFER]), // 1%
    limitPolicy,
  });
  service.openWallet('asha');
  service.openWallet('ravi');
  return { service, clock, limitPolicy };
}

describe('Ledger', () => {
  it('rejects unbalanced or overdrawing postings without writing anything', () => {
    const ledger = new Ledger();
    ledger.openAccount('BANK', AccountType.BANK_CLEARING);
    const wallet = ledger.openAccount('W1', AccountType.USER_WALLET, 'u1');
    const at = new Date('2026-03-01T09:00:00Z');

    expect(() =>
      ledger.post('T1', [
        { accountId: 'BANK', direction: EntryDirection.DEBIT, amount: 100 },
        { accountId: 'W1', direction: EntryDirection.CREDIT, amount: 90 },
      ], at),
    ).toThrow(UnbalancedPostingError);
    expect(() =>
      ledger.post('T2', [
        { accountId: 'W1', direction: EntryDirection.DEBIT, amount: 100 },
        { accountId: 'BANK', direction: EntryDirection.CREDIT, amount: 100 },
      ], at),
    ).toThrow(InsufficientBalanceError);
    expect(ledger.entries).toHaveLength(0);
    expect(wallet.balance).toBe(0);
  });

  it('reconciliation catches a cached balance changed outside the ledger', () => {
    const ledger = new Ledger();
    const wallet = ledger.openAccount('W1', AccountType.USER_WALLET, 'u1');
    expect(() => ledger.verify()).not.toThrow();
    wallet.apply(500); // a buggy writer bypassing post()
    expect(() => ledger.verify()).toThrow(LedgerIntegrityError);
  });
});

describe('Transaction', () => {
  it('only allows PENDING -> COMPLETED|FAILED and COMPLETED -> REVERSED', () => {
    const at = new Date('2026-03-01T09:00:00Z');
    const details = {
      type: TransactionType.TRANSFER,
      initiatedBy: 'u1',
      fromAccountId: 'W1',
      toAccountId: 'W2',
      amount: 100,
      fee: 0,
      reversalOf: null,
    };
    const txn = new Transaction('T1', 1, details, at);
    expect(() => txn.markReversed('T2', at)).toThrow(InvalidTransactionStateError);
    txn.complete(at);
    expect(() => txn.fail('late failure', at)).toThrow(InvalidTransactionStateError);
    txn.markReversed('T2', at);
    expect(txn.status).toBe(TransactionStatus.REVERSED);
    expect(() => txn.complete(at)).toThrow(InvalidTransactionStateError);

    const failed = new Transaction('T3', 2, details, at);
    failed.fail('declined', at);
    expect(() => failed.complete(at)).toThrow(InvalidTransactionStateError);
  });
});

describe('WalletService', () => {
  let service: WalletService;
  let clock: FakeClock;
  let limitPolicy: TieredDailyLimitPolicy;

  beforeEach(() => {
    ({ service, clock, limitPolicy } = buildService());
  });

  it('tops up with two balanced entries: debit bank clearing, credit the wallet', () => {
    const txn = service.topUp({ userId: 'asha', amount: 1_000_000, idempotencyKey: 'k1' });

    expect(txn.status).toBe(TransactionStatus.COMPLETED);
    expect(service.balanceOf('asha')).toBe(1_000_000);
    expect(service.ledger.account(BANK_CLEARING_ACCOUNT_ID).balance).toBe(1_000_000);
    const entries = service.ledger.entriesFor(txn.id);
    expect(entries.map((e) => [e.direction, e.accountId, e.amount])).toEqual([
      [EntryDirection.DEBIT, BANK_CLEARING_ACCOUNT_ID, 1_000_000],
      [EntryDirection.CREDIT, 'WAL-1', 1_000_000],
    ]);
    expect(entries.reduce((sum, e) => sum + e.signedAmount, 0)).toBe(0);
  });

  it('charges the transfer fee as a third line credited to FEES', () => {
    service.topUp({ userId: 'asha', amount: 1_000_000, idempotencyKey: 'k1' });
    const txn = service.transfer({ fromUserId: 'asha', toUserId: 'ravi', amount: 250_000, idempotencyKey: 'k2' });

    expect(txn.fee).toBe(2_500);
    expect(service.ledger.entriesFor(txn.id)).toHaveLength(3);
    expect(service.balanceOf('asha')).toBe(747_500);
    expect(service.balanceOf('ravi')).toBe(250_000);
    expect(service.ledger.account(FEES_ACCOUNT_ID).balance).toBe(2_500);
  });

  it('records a FAILED transaction with no entries when the balance is insufficient', () => {
    const entriesBefore = service.ledger.entries.length;
    expect(() =>
      service.transfer({ fromUserId: 'ravi', toUserId: 'asha', amount: 100, idempotencyKey: 'k1' }),
    ).toThrow(InsufficientBalanceError);

    const [failed] = service.history('ravi').items;
    expect(failed.status).toBe(TransactionStatus.FAILED);
    expect(failed.failureReason).toContain('needs');
    expect(service.ledger.entriesFor(failed.id)).toHaveLength(0);
    expect(service.ledger.entries).toHaveLength(entriesBefore);
    expect(service.balanceOf('ravi')).toBe(0);
  });

  it('returns the original transaction for a replayed key and never posts twice', () => {
    service.topUp({ userId: 'asha', amount: 1_000_000, idempotencyKey: 'k1' });
    const request = { fromUserId: 'asha', toUserId: 'ravi', amount: 100_000, idempotencyKey: 'order-42' };
    const first = service.transfer(request);
    const entries = service.ledger.entries.length;

    const replay = service.transfer(request);

    expect(replay).toBe(first);
    expect(service.ledger.entries).toHaveLength(entries);
    expect(service.balanceOf('ravi')).toBe(100_000);
    expect(service.history('ravi').items).toHaveLength(1);
    expect(() => service.transfer({ ...request, amount: 999 })).toThrow(IdempotencyKeyReusedError);
  });

  it('replays a failed request with its original error, even after money arrives', () => {
    const request = { fromUserId: 'ravi', toUserId: 'asha', amount: 50_000, idempotencyKey: 'k1' };
    expect(() => service.transfer(request)).toThrow(InsufficientBalanceError);
    service.topUp({ userId: 'ravi', amount: 100_000, idempotencyKey: 'k2' });

    expect(() => service.transfer(request)).toThrow(InsufficientBalanceError);
    expect(service.balanceOf('ravi')).toBe(100_000);
    expect(service.history('ravi').items.map((t) => t.status)).toEqual([
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
    ]);
  });

  it('reverses a transfer with compensating entries and refunds the fee', () => {
    service.topUp({ userId: 'asha', amount: 1_000_000, idempotencyKey: 'k1' });
    const payment = service.transfer({ fromUserId: 'asha', toUserId: 'ravi', amount: 250_000, idempotencyKey: 'k2' });

    const reversal = service.reverse({ transactionId: payment.id, idempotencyKey: 'k3' });

    expect(reversal.status).toBe(TransactionStatus.COMPLETED);
    expect(reversal.reversalOf).toBe(payment.id);
    expect(payment.status).toBe(TransactionStatus.REVERSED);
    expect(payment.reversedBy).toBe(reversal.id);
    expect(service.balanceOf('asha')).toBe(1_000_000);
    expect(service.balanceOf('ravi')).toBe(0);
    expect(service.ledger.account(FEES_ACCOUNT_ID).balance).toBe(0);
    expect(service.ledger.entriesFor(payment.id)).toHaveLength(3); // the original lines are kept
    expect(() => service.reverse({ transactionId: payment.id, idempotencyKey: 'k4' })).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => service.reverse({ transactionId: reversal.id, idempotencyKey: 'k5' })).toThrow(
      TransactionNotReversibleError,
    );
  });

  it('refuses a reversal the receiver can no longer fund and keeps the original COMPLETED', () => {
    service.topUp({ userId: 'asha', amount: 1_000_000, idempotencyKey: 'k1' });
    const payment = service.transfer({ fromUserId: 'asha', toUserId: 'ravi', amount: 250_000, idempotencyKey: 'k2' });
    service.withdraw({ userId: 'ravi', amount: 200_000, idempotencyKey: 'k3' });

    expect(() => service.reverse({ transactionId: payment.id, idempotencyKey: 'k4' })).toThrow(
      InsufficientBalanceError,
    );
    expect(payment.status).toBe(TransactionStatus.COMPLETED);
    expect(service.balanceOf('ravi')).toBe(50_000);
  });

  it('enforces the daily withdrawal limit from the clock and resets it at midnight UTC', () => {
    service.topUp({ userId: 'asha', amount: 2_000_000, idempotencyKey: 'k1' });
    service.withdraw({ userId: 'asha', amount: 300_000, idempotencyKey: 'k2' });
    expect(() => service.withdraw({ userId: 'asha', amount: 250_000, idempotencyKey: 'k3' })).toThrow(
      DailyLimitExceededError,
    );
    service.withdraw({ userId: 'asha', amount: 200_000, idempotencyKey: 'k4' }); // exactly at the limit

    clock.set('2026-03-02T00:00:00Z');
    service.withdraw({ userId: 'asha', amount: 500_000, idempotencyKey: 'k5' });
    limitPolicy.setUserLimit('asha', TransactionType.WITHDRAWAL, 600_000); // upgraded KYC
    service.withdraw({ userId: 'asha', amount: 100_000, idempotencyKey: 'k6' });
    expect(service.balanceOf('asha')).toBe(900_000);
  });

  it('pages history newest first with a cursor that new activity cannot shift', () => {
    for (let i = 1; i <= 5; i += 1) service.topUp({ userId: 'asha', amount: i * 100, idempotencyKey: `t${i}` });

    const first = service.history('asha', { limit: 2 });
    service.topUp({ userId: 'asha', amount: 600, idempotencyKey: 't6' }); // arrives between page loads
    const second = service.history('asha', { limit: 2, cursor: first.nextCursor });
    const third = service.history('asha', { limit: 2, cursor: second.nextCursor });

    expect(first.items.map((t) => t.amount)).toEqual([500, 400]);
    expect(second.items.map((t) => t.amount)).toEqual([300, 200]);
    expect(third.items.map((t) => t.amount)).toEqual([100]);
    expect(third.nextCursor).toBeUndefined();
  });

  it('rejects malformed requests before recording anything', () => {
    expect(() => service.topUp({ userId: 'asha', amount: 0, idempotencyKey: 'a' })).toThrow(InvalidAmountError);
    expect(() => service.topUp({ userId: 'asha', amount: 10.5, idempotencyKey: 'b' })).toThrow(InvalidAmountError);
    expect(() => service.topUp({ userId: 'nobody', amount: 100, idempotencyKey: 'c' })).toThrow(WalletNotFoundError);
    expect(() =>
      service.transfer({ fromUserId: 'asha', toUserId: 'asha', amount: 100, idempotencyKey: 'd' }),
    ).toThrow(SameWalletTransferError);
    expect(() => service.openWallet('asha')).toThrow(WalletAlreadyExistsError);
    expect(service.history('asha').items).toHaveLength(0);
    expect(service.ledger.entries).toHaveLength(0);
  });

  it('keeps entries zero-sum and every cached balance equal to its entries over a long script', () => {
    const users = ['asha', 'ravi', 'meera', 'kabir'];
    service.openWallet('meera');
    service.openWallet('kabir');
    const transfers: string[] = [];
    let rejected = 0;

    for (let step = 0; step < 120; step += 1) {
      const user = users[step % users.length];
      const other = users[(step + 1 + Math.floor(step / users.length)) % users.length];
      const amount = ((step * 7_919) % 400_000) + 100; // deterministic but varied
      const key = `step-${step}`;
      try {
        const toReverse = step % 5 === 4 ? transfers.shift() : undefined;
        if (step % 5 === 0) service.topUp({ userId: user, amount: amount * 3, idempotencyKey: key });
        else if (step % 5 === 3) service.withdraw({ userId: user, amount, idempotencyKey: key });
        else if (toReverse) service.reverse({ transactionId: toReverse, idempotencyKey: key });
        else if (user !== other) {
          transfers.push(service.transfer({ fromUserId: user, toUserId: other, amount, idempotencyKey: key }).id);
        }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        rejected += 1;
      }
      clock.advanceHours(5);
      expect(service.ledger.entries.reduce((sum, e) => sum + e.signedAmount, 0)).toBe(0);
    }

    expect(rejected).toBeGreaterThan(0);
    expect(() => service.ledger.verify()).not.toThrow();
    const { debits, credits } = service.ledger.trialBalance();
    expect(debits).toBe(credits);
    const wallets = users.reduce((sum, user) => sum + service.balanceOf(user), 0);
    const fees = service.ledger.account(FEES_ACCOUNT_ID).balance;
    expect(service.ledger.account(BANK_CLEARING_ACCOUNT_ID).balance).toBe(wallets + fees);
    for (const user of users) expect(service.balanceOf(user)).toBeGreaterThanOrEqual(0);
  });
});
