import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Account,
  assertAtmTransition,
  Atm,
  AtmState,
  Card,
  CardBlockedError,
  CardExpiredError,
  CashDispenser,
  DailyLimitExceededError,
  InMemoryBankService,
  InsufficientCashError,
  InsufficientFundsError,
  InvalidAtmOperationError,
  InvalidAtmTransitionError,
  InvalidPinError,
  RUPEE,
  TransactionType,
  UnmakeableAmountError,
} from './index';

const rs = (rupees: number) => rupees * RUPEE;

function build(options: { notes?: Record<number, number>; balance?: number; dailyLimit?: number } = {}) {
  const clock = new FakeClock('2026-03-01T10:00:00Z');
  const bank = new InMemoryBankService({
    dailyWithdrawalLimit: rs(options.dailyLimit ?? 20_000),
    clock,
    ids: new SequentialIdGenerator(),
  });
  const card = new Card('4111000011112222', 'Asha', new Date('2028-12-31T00:00:00Z'));
  bank.openAccount(new Account('ACC-1', 'Asha', rs(options.balance ?? 50_000))).registerCard(card, 'ACC-1', '1234', 'salt');
  const dispenser = new CashDispenser(
    options.notes ?? { [rs(2_000)]: 10, [rs(500)]: 10, [rs(200)]: 10, [rs(100)]: 10 },
  );
  const atm = new Atm('ATM-7', { bank, dispenser, clock, ids: new SequentialIdGenerator() });
  const login = () => {
    atm.insertCard(card);
    atm.enterPin('1234');
  };
  return { atm, bank, dispenser, card, clock, login };
}

describe('Authentication', () => {
  it('authenticates with the right PIN and ejects back to IDLE', () => {
    const { atm, card, login } = build();
    login();
    expect(atm.currentState).toBe(AtmState.AUTHENTICATED);
    expect(atm.balance()).toBe(rs(50_000));
    expect(atm.ejectCard()).toBe(card);
    expect(atm.currentState).toBe(AtmState.IDLE);
  });

  it('blocks and retains the card after three wrong PINs', () => {
    const { atm, card } = build();
    atm.insertCard(card);
    expect(() => atm.enterPin('0000')).toThrow(new InvalidPinError(2));
    expect(() => atm.enterPin('0000')).toThrow(new InvalidPinError(1));
    expect(atm.currentState).toBe(AtmState.CARD_INSERTED);
    expect(() => atm.enterPin('0000')).toThrow(CardBlockedError);
    expect(atm.currentState).toBe(AtmState.IDLE);
    expect(atm.retainedCards).toEqual([card]);

    atm.insertCard(card);
    expect(() => atm.enterPin('1234')).toThrow(CardBlockedError);
  });

  it('resets the attempt counter after a correct PIN', () => {
    const { atm, card } = build();
    atm.insertCard(card);
    expect(() => atm.enterPin('0000')).toThrow(InvalidPinError);
    expect(() => atm.enterPin('0000')).toThrow(InvalidPinError);
    atm.enterPin('1234');
    atm.ejectCard();
    atm.insertCard(card);
    expect(() => atm.enterPin('0000')).toThrow(new InvalidPinError(2));
  });

  it('rejects an expired card', () => {
    const { atm } = build();
    const old = new Card('4111000099990000', 'Old', new Date('2025-01-01T00:00:00Z'));
    expect(() => atm.insertCard(old)).toThrow(CardExpiredError);
    expect(atm.currentState).toBe(AtmState.IDLE);
  });
});

describe('Withdrawal', () => {
  it('debits the account and dispenses notes largest first', () => {
    const { atm, dispenser, login } = build();
    login();
    const receipt = atm.withdraw(rs(2_800));
    expect([...receipt.notes]).toEqual([
      [rs(2_000), 1],
      [rs(500), 1],
      [rs(200), 1],
      [rs(100), 1],
    ]);
    expect(receipt.balance).toBe(rs(47_200));
    expect(dispenser.inventory().get(rs(2_000))).toBe(9);
  });

  it('the cassette chain skips empty denominations and respects counts', () => {
    const dispenser = new CashDispenser({ [rs(2_000)]: 1, [rs(200)]: 5, [rs(100)]: 2 });
    expect([...dispenser.dispense(rs(2_600))]).toEqual([
      [rs(2_000), 1],
      [rs(200), 3],
    ]);
    expect(() => dispenser.dispense(rs(150))).toThrow(UnmakeableAmountError);
    expect(() => dispenser.dispense(rs(5_000))).toThrow(InsufficientCashError);
    expect(dispenser.total()).toBe(rs(600));
  });

  it('rolls back the debit when the amount cannot be dispensed', () => {
    const { atm, bank, login } = build();
    login();
    expect(() => atm.withdraw(rs(150))).toThrow(UnmakeableAmountError);
    expect(atm.balance()).toBe(rs(50_000));
    expect(atm.miniStatement(2).map((t) => t.type)).toEqual([TransactionType.REVERSAL, TransactionType.WITHDRAWAL]);
    expect(bank.statement('ACC-1', 1)[0]?.reverses).toBe('TXN-1');
  });

  it('rolls back when the ATM runs out of cash, and the daily limit is restored', () => {
    const { atm, login } = build({ notes: { [rs(500)]: 2 }, dailyLimit: 1_500 });
    login();
    expect(() => atm.withdraw(rs(1_500))).toThrow(InsufficientCashError);
    expect(atm.balance()).toBe(rs(50_000));
    expect(atm.withdraw(rs(1_000)).balance).toBe(rs(49_000));
  });

  it('refuses more than the balance without touching the cash', () => {
    const { atm, dispenser, login } = build({ balance: 1_000 });
    login();
    expect(() => atm.withdraw(rs(2_000))).toThrow(InsufficientFundsError);
    expect(dispenser.total()).toBe(rs(28_000));
  });

  it('enforces the daily limit and resets it the next day', () => {
    const { atm, clock, login } = build({ dailyLimit: 10_000 });
    login();
    atm.withdraw(rs(6_000));
    expect(() => atm.withdraw(rs(5_000))).toThrow(DailyLimitExceededError);
    clock.advanceHours(24);
    expect(atm.withdraw(rs(5_000)).balance).toBe(rs(39_000));
  });

  it('a retried bank request with the same id debits only once', () => {
    const { bank } = build();
    const first = bank.withdraw('ACC-1', rs(1_000), 'REQ-42');
    const retry = bank.withdraw('ACC-1', rs(1_000), 'REQ-42');
    expect(retry).toBe(first);
    expect(bank.balance('ACC-1')).toBe(rs(49_000));
  });
});

describe('Deposit, statement and states', () => {
  it('credits deposits and returns the last N transactions newest first', () => {
    const { atm, login } = build();
    login();
    atm.withdraw(rs(1_000));
    atm.deposit({ [rs(500)]: 4, [rs(100)]: 3 });
    atm.withdraw(rs(200));
    const statement = atm.miniStatement(2);
    expect(statement.map((t) => [t.type, t.amount])).toEqual([
      [TransactionType.WITHDRAWAL, rs(200)],
      [TransactionType.DEPOSIT, rs(2_300)],
    ]);
    expect(atm.balance()).toBe(rs(51_100));
  });

  it('rejects operations the current state does not allow', () => {
    const { atm, card } = build();
    expect(() => atm.withdraw(rs(100))).toThrow(InvalidAtmOperationError);
    expect(() => atm.enterPin('1234')).toThrow(InvalidAtmOperationError);
    atm.insertCard(card);
    expect(() => atm.insertCard(card)).toThrow(InvalidAtmOperationError);
    expect(() => atm.balance()).toThrow(InvalidAtmOperationError);
    expect(() => assertAtmTransition(AtmState.IDLE, AtmState.AUTHENTICATED)).toThrow(InvalidAtmTransitionError);
  });
});
