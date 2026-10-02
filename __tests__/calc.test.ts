import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankStatement, computeLedger, customerLedger, periodReport } from '../src/calc';
import { defaultData, newDay } from '../src/defaults';
import { initialCarry } from '../src/calc';
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
