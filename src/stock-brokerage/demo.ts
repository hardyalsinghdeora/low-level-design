import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { formatMoney } from '../shared/money';
import { Brokerage, OrderSide, OrderType, PercentageFeeStrategy, type OrderRequest } from './index';

const brokerage = new Brokerage({
  clock: new FakeClock('2026-03-02T09:15:00Z'),
  ids: new SequentialIdGenerator(),
  feeStrategy: new PercentageFeeStrategy(10, 2_000), // 0.1% per order, minimum Rs 20
});
brokerage.listSymbol('ACME');
brokerage.subscribe({
  onExecution: (t) =>
    console.log(`  [tape] ${t.quantity} ${t.symbol} @ ${formatMoney(t.price)}  ${t.sellerId} -> ${t.buyerId}  fees ${formatMoney(t.buyerFee)} / ${formatMoney(t.sellerFee)}`),
});
const asha = brokerage.openAccount('asha');
asha.deposit(1_000_000);
for (const seller of ['ravi', 'meera', 'dev']) brokerage.openAccount(seller).depositShares('ACME', 50);

const limit = (userId: string, side: OrderSide, quantity: number, limitPrice: number): OrderRequest => ({ userId, symbol: 'ACME', side, type: OrderType.LIMIT, quantity, limitPrice });
const printBook = () => {
  const fmt = (side: OrderSide) => brokerage.book('ACME').depth(side).map((l) => `${l.quantity}@${formatMoney(l.price)}`).join(', ') || '-';
  console.log(`  book  asks: ${fmt(OrderSide.SELL)} | bids: ${fmt(OrderSide.BUY)}`);
};
const printAsha = () => {
  const p = brokerage.portfolio('asha');
  console.log(`  asha  cash ${formatMoney(p.availableCash)} + reserved ${formatMoney(p.reservedCash)}, ` +
    `${p.positions.map((x) => `${x.quantity} ${x.symbol} = ${formatMoney(x.marketValue)}`).join(', ') || 'no shares'}, total ${formatMoney(p.totalValue)}`);
};

console.log('\n--- Sellers post asks; Ravi and Meera at the same price, Ravi first ---');
brokerage.placeOrder(limit('ravi', OrderSide.SELL, 20, 10_000));
brokerage.placeOrder(limit('meera', OrderSide.SELL, 20, 10_000));
brokerage.placeOrder(limit('dev', OrderSide.SELL, 30, 10_300));
printBook();

console.log('\n--- Asha bids 30 @ Rs 101: Ravi fills first (time priority), then Meera partially ---');
const bid = brokerage.placeOrder(limit('asha', OrderSide.BUY, 30, 10_100));
console.log(`  ${bid.id} ${bid.status}, paid fees ${formatMoney(bid.feesPaid)}, price improvement returned`);
printBook();
printAsha();

console.log('\n--- Asha tries a bid she cannot fund: the reservation check refuses it ---');
try {
  brokerage.placeOrder(limit('asha', OrderSide.BUY, 100, 10_300));
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- She rests a lower bid, then cancels it: the reserved cash comes back ---');
const low = brokerage.placeOrder(limit('asha', OrderSide.BUY, 10, 9_500));
printAsha();
brokerage.cancelOrder(low.id);
printAsha();

console.log('\n--- A market buy for 25 sweeps Meera\'s 10 and Dev\'s ask ---');
const sweep = brokerage.placeOrder({ userId: 'asha', symbol: 'ACME', side: OrderSide.BUY, type: OrderType.MARKET, quantity: 25 });
console.log(`  ${sweep.id} ${sweep.status}: ${sweep.filledQuantity}/${sweep.quantity} filled`);
printBook();
printAsha();
console.log(`  brokerage fees collected ${formatMoney(brokerage.feesCollected)}`);
