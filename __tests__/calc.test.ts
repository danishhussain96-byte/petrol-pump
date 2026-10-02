import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankStatement, computeLedger, customerLedger, periodReport } from '../src/calc';
import { defaultData, newDay, normalize } from '../src/defaults';
import { initialCarry, payBankFor } from '../src/calc';
import type { AppData } from '../src/types';

function setup(): AppData {
  const data = defaultData();
  const petrol = data.products.find((p) => p.id === 'petrol')!;
  petrol.rate = 260;
  petrol.costRate = 250;
  petrol.openingStock = 10000;
  const diesel = data.products.find((p) => p.id === 'diesel')!;
  diesel.rate = 270;
  diesel.costRate = 262;
  diesel.openingStock = 5000;
  const oil = data.products.find((p) => p.id === 'mobiloil')!;
  oil.rate = 1500;
  oil.costRate = 1200;
  oil.openingStock = 20;
  data.nozzles = [
    { id: 'n1', name: 'N1', productId: 'petrol', openingReading: 1000, active: true },
    { id: 'n3', name: 'N3', productId: 'diesel', openingReading: 500, active: true },
  ];
  data.salesmen = [
    { id: 'ali', name: 'Ali', phone: '', active: true },
    { id: 'raza', name: 'Raza', phone: '', active: true },
  ];
  data.banks = [{ id: 'hbl', name: 'HBL', accountNo: '1', openingBalance: 100000, active: true }];
  data.customers = [{ id: 'c1', name: 'Transport Co', phone: '', vehicleNo: '', openingBalance: 5000, creditLimit: 0, active: true }];
  data.settings.openingCash = 20000;
  data.settings.cardBankId = 'hbl';
  return data;
}

test('day sales, salesman settlement, stock and cash', () => {
  const data = setup();
  const day = newDay(data, '2026-10-01', initialCarry(data));
  assert.equal(day.readings[0].opening, 1000);
  day.readings[0] = { ...day.readings[0], closing: 1500, testLitres: 5, salesmanId: 'ali' }; // 495 L petrol
  day.readings[1] = { ...day.readings[1], closing: 700, salesmanId: 'raza' }; // 200 L diesel
  day.itemSales.push({ id: 'i1', productId: 'mobiloil', qty: 2, salesmanId: 'ali' }); // 3000
  day.creditSales.push({ id: 'cs', customerId: 'c1', salesmanId: 'raza', productId: 'diesel', qty: 50, amount: 13500, vehicleNo: '', slipNo: '' });
  day.settlements.push({ salesmanId: 'ali', cardSales: 10000, digitalSales: 0, cashReceived: 121700 });
  day.settlements.push({ salesmanId: 'raza', cardSales: 0, digitalSales: 0, cashReceived: 40000 });
  day.purchases.push({ id: 'p', productId: 'petrol', qty: 2000, rate: 250, supplier: 'PSO', invoiceNo: '', payMode: 'bank', bankId: 'hbl' });
  day.expenses.push({ id: 'e', head: 'Electricity', amount: 1500, mode: 'cash', note: '' });
  day.bankTxns.push({ id: 'b', bankId: 'hbl', type: 'deposit', amount: 150000, ref: '', note: '' });
  day.dips = { petrol: 11500 };
  data.days[day.date] = day;

  const ledger = computeLedger(data);
  const s = ledger.summaries['2026-10-01'];
  assert.equal(s.fuelLitres, 695);
  assert.equal(s.fuelAmount, 495 * 260 + 200 * 270);
  assert.equal(s.totalSales, 128700 + 54000 + 3000);

  const ali = s.salesmen.find((r) => r.salesmanId === 'ali')!;
  assert.equal(ali.saleAmount, 131700);
  assert.equal(ali.cashDue, 121700);
  assert.equal(ali.diff, 0);
  const raza = s.salesmen.find((r) => r.salesmanId === 'raza')!;
  assert.equal(raza.cashDue, 54000 - 13500);
  assert.equal(raza.diff, -500); // short

  const petrol = s.stock.find((r) => r.productId === 'petrol')!;
  assert.equal(petrol.book, 10000 + 2000 - 495);
  assert.equal(petrol.variance, 11500 - 11505);
  const oil = s.stock.find((r) => r.productId === 'mobiloil')!;
  assert.equal(oil.closing, 18);

  // cash: 20000 + 161700 - 1500 - 150000
  assert.equal(s.cash.expected, 30200);

  // next day carries meters, stock and cash
  const d2 = newDay(data, '2026-10-02', ledger.final);
  assert.equal(d2.readings[0].opening, 1500);
  data.days[d2.date] = d2;
  const l2 = computeLedger(data);
  assert.equal(l2.summaries['2026-10-02'].stock.find((r) => r.productId === 'petrol')!.opening, 11500);
  assert.equal(l2.summaries['2026-10-02'].cash.opening, 30200);

  // bank: 100000 + 150000 deposit + 10000 card - 500000 purchase
  const st = bankStatement(data, l2, 'hbl', '2026-10-01', '2026-10-31');
  assert.equal(st.opening, 100000);
  assert.equal(st.closing, 100000 + 150000 + 10000 - 500000);
  assert.equal(st.rows.length, 3);
  const later = bankStatement(data, l2, 'hbl', '2026-10-02', '2026-10-31');
  assert.equal(later.opening, st.closing);
  assert.equal(later.rows.length, 0);

  const cl = customerLedger(data, 'c1');
  assert.equal(cl.balance, 18500);

  const rep = periodReport(data, l2, '2026-10-01', '2026-10-31');
  assert.equal(rep.days, 2);
  assert.equal(rep.shortExcess, -500);
  assert.equal(rep.totalSales, 185700);
});

test('cash count overrides expected closing', () => {
  const data = setup();
  const day = newDay(data, '2026-10-01', initialCarry(data));
  day.cashCount = { '5000': 3, '1000': 4, '100': 9 };
  day.looseCash = 50;
  data.days[day.date] = day;
  const s = computeLedger(data).summaries[day.date];
  assert.equal(s.cash.counted, 19950);
  assert.equal(s.cash.difference, -50);
  assert.equal(s.cash.closing, 19950);
});

test('default layout is 3 dispensing units with 4 nozzles each', () => {
  const data = defaultData();
  assert.equal(data.units.length, 3);
  assert.equal(data.nozzles.length, 12);
  for (const u of data.units) assert.equal(data.nozzles.filter((n) => n.unitId === u.id).length, 4);
});

test('card / digital sales post to each dispenser bank', () => {
  const data = defaultData();
  data.products.find((p) => p.id === 'petrol')!.rate = 100;
  data.banks = [
    { id: 'hbl', name: 'HBL', accountNo: '', openingBalance: 0, active: true },
    { id: 'mzn', name: 'Meezan', accountNo: '', openingBalance: 0, active: true },
  ];
  data.salesmen = [{ id: 'ali', name: 'Ali', phone: '', active: true }];
  data.units[0].cardBankId = 'hbl';
  data.units[1].cardBankId = 'mzn';
  data.settings.digitalBankId = 'hbl';
  const day = newDay(data, '2026-10-01', initialCarry(data));
  // Ali sells 100 L on D1-N1 and 50 L on D2-N1
  day.readings = day.readings.map((r) =>
    r.nozzleId === 'du1n1' ? { ...r, closing: 100, salesmanId: 'ali' } : r.nozzleId === 'du2n1' ? { ...r, closing: 50, salesmanId: 'ali' } : r,
  );
  day.settlements.push({
    salesmanId: 'ali',
    cardSales: 0,
    digitalSales: 0,
    cashReceived: 9000,
    payments: { 'card:hbl': 3000, 'card:mzn': 2000, 'digital:hbl': 1000 },
  });
  data.days[day.date] = day;
  const l = computeLedger(data);
  const s = l.summaries[day.date];
  assert.deepEqual(
    s.units.map((u) => [u.unitId, u.litres, u.amount]),
    [['du1', 100, 10000], ['du2', 50, 5000], ['du3', 0, 0]],
  );
  const ali = s.salesmen[0];
  assert.equal(ali.card, 5000);
  assert.equal(ali.digital, 1000);
  assert.equal(ali.cashDue, 9000);
  assert.equal(ali.diff, 0);
  assert.equal(bankStatement(data, l, 'hbl', '2026-10-01', '2026-10-01').closing, 4000);
  assert.equal(bankStatement(data, l, 'mzn', '2026-10-01', '2026-10-01').closing, 2000);
  assert.equal(payBankFor(data, 'card', 'du3n1'), ''); // no unit bank, no default
  assert.equal(payBankFor(data, 'digital', 'du3n1'), 'hbl'); // falls back to Settings
  assert.deepEqual(periodReport(data, l, '2026-10-01', '2026-10-01').byUnit.map((u) => u.litres), [100, 50, 0]);
});

test('v1.0.0 data migrates to dispensing units', () => {
  const oldNozzles = [1, 2, 3, 4].map((i) => ({ id: `n${i}`, name: `Nozzle ${i}`, productId: 'petrol', openingReading: 0, active: true }));
  const fresh = normalize({ ...defaultData(), units: undefined, nozzles: oldNozzles });
  assert.equal(fresh.units.length, 3);
  assert.equal(fresh.nozzles.length, 12);

  const used = { ...defaultData(), units: undefined, nozzles: oldNozzles.map((n) => ({ ...n, openingReading: 500 })) };
  const kept = normalize(used);
  assert.equal(kept.units.length, 1);
  assert.deepEqual(kept.nozzles.map((n) => [n.id, n.unitId]), [['n1', 'du1'], ['n2', 'du1'], ['n3', 'du1'], ['n4', 'du1']]);
});

test('tanker purchases: cost per litre from total amount, running average across tankers', () => {
  const data = defaultData();
  data.products.find((p) => p.id === 'petrol')!.rate = 270;
  data.products.find((p) => p.id === 'petrol')!.openingStock = 1000; // cost unknown
  data.nozzles = [{ id: 'n1', name: 'N1', productId: 'petrol', openingReading: 0, active: true }];

  // Day 1: 12,000 L tanker invoiced, 11,950 L received, total Rs 3,060,000 → 256.0669/L
  const d1 = newDay(data, '2026-10-01', initialCarry(data));
  d1.purchases.push({ id: 't1', productId: 'petrol', invoiceQty: 12000, qty: 11950, amount: 3060000, rate: 0, supplier: 'PSO', invoiceNo: 'B-1', payMode: 'credit' });
  d1.readings = [{ nozzleId: 'n1', opening: 0, closing: 2950, testLitres: 0 }];
  data.days[d1.date] = d1;
  let l = computeLedger(data);
  const r1 = l.summaries[d1.date].stock.find((r) => r.productId === 'petrol')!;
  // unknown-cost opening stock is ignored, so the tanker sets the cost
  assert.equal(r1.costRate, 256.0669);
  assert.equal(r1.closing, 1000 + 11950 - 2950);
  assert.equal(l.summaries[d1.date].grossMargin, Math.round(2950 * (270 - 256.0669) * 100) / 100);

  // Day 2: smaller tanker at a higher price: 5,000 L for Rs 1,325,000 (265/L)
  const d2 = newDay(data, '2026-10-02', l.final);
  d2.purchases.push({ id: 't2', productId: 'petrol', qty: 5000, amount: 1325000, rate: 0, supplier: '', invoiceNo: '', payMode: 'cash' });
  data.days[d2.date] = d2;
  l = computeLedger(data);
  const r2 = l.summaries[d2.date].stock.find((r) => r.productId === 'petrol')!;
  // (10,000 × 256.0669 + 1,325,000) / 15,000
  assert.equal(r2.costRate, Math.round(((10000 * 256.0669 + 1325000) / 15000) * 10000) / 10000);
  assert.equal(l.summaries[d2.date].cash.purchases, 1325000);
  assert.equal(l.summaries[d2.date].purchasesAmount, 1325000);
});

test('sale with no known cost is left out of margin', () => {
  const data = defaultData();
  data.products.find((p) => p.id === 'petrol')!.rate = 270;
  data.nozzles = [{ id: 'n1', name: 'N1', productId: 'petrol', openingReading: 0, active: true }];
  const d = newDay(data, '2026-10-01', initialCarry(data));
  d.readings = [{ nozzleId: 'n1', opening: 0, closing: 100, testLitres: 0 }];
  data.days[d.date] = d;
  const s = computeLedger(data).summaries[d.date];
  assert.equal(s.grossMargin, 0);
  assert.deepEqual(s.costUnknown, ['petrol']);
});

test('day opened before rates were set follows the product rate', () => {
  const data = defaultData();
  data.nozzles = [{ id: 'n1', name: 'N1', productId: 'petrol', openingReading: 0, active: true }];
  const d = newDay(data, '2026-10-01', initialCarry(data)); // petrol rate still 0
  d.readings = [{ nozzleId: 'n1', opening: 0, closing: 10, testLitres: 0 }];
  data.days[d.date] = d;
  data.products.find((p) => p.id === 'petrol')!.rate = 270;
  assert.equal(computeLedger(data).summaries[d.date].fuelAmount, 2700);
});
