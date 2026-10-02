import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankStatement, computeLedger, emptyDay, creditStatus, customerLedger, initialCarry } from '../src/calc';
import { creditMessage, daySummaryMessage, paymentMessage } from '../src/creditMessage';
import { defaultData, newDay, normalize } from '../src/defaults';
import type { AppData } from '../src/types';

/** The notebook page: MS (petrol) and Power on one dispenser, 10 L test each. */
function notebookDay(): AppData {
  const data = defaultData();
  data.settings.stationName = 'Test Station';
  data.products.find((p) => p.id === 'petrol')!.rate = 108.32;
  data.products.find((p) => p.id === 'hioctane')!.rate = 118.23;
  data.banks = [{ id: 'sbi', name: 'SBI', accountNo: '', openingBalance: 0, active: true }];
  data.units[0].bankId = 'sbi';
  data.salesmen = [{ id: 'ram', name: 'Ram', phone: '', active: true }];
  data.customers = [{ id: 'c1', name: 'Sharma Transport', phone: '9876543210', vehicleNo: 'MH12AB1234', openingBalance: 0, creditLimit: 0, creditDays: 30, active: true }];
  const d = newDay(data, '2026-10-01', initialCarry(data));
  const set = (id: string, productId: string, opening: number, closing: number, test = 0) => {
    const r = d.readings.find((x) => x.nozzleId === id)!;
    Object.assign(r, { productId, opening, closing, testLitres: test, salesmanId: 'ram' });
  };
  set('du1n1', 'petrol', 448008.96, 448291.66, 10); // A1  282.7 L
  set('du1n2', 'petrol', 1179460.36, 1180359.36); // A2  899 L
  set('du1n3', 'hioctane', 74185.74, 74216.54, 10); // B1 30.8 L
  set('du1n4', 'hioctane', 90397.052, 90458.662); // B2 61.61 L
  d.unitSettlements = { du1: { cash: 83617, online: 24034, pos: 30920 } };
  d.creditSales.push({ id: 'cs1', customerId: 'c1', unitId: 'du1', nozzleId: 'du1n2', productId: 'petrol', qty: 2.5, amount: 270.8, vehicleNo: 'MH12AB1234', slipNo: '' });
  data.days[d.date] = d;
  return data;
}

test('dispenser sheet: product-wise sale and receipts, like the notebook', () => {
  const data = notebookDay();
  const s = computeLedger(data).summaries['2026-10-01'];
  const u = s.unitSales.find((x) => x.unitId === 'du1')!;
  const petrol = u.byProduct.find((p) => p.productId === 'petrol')!;
  const power = u.byProduct.find((p) => p.productId === 'hioctane')!;
  // A1 282.7 − 10 test + A2 899 = 1171.7 L
  assert.equal(petrol.litres, 1171.7);
  assert.equal(power.litres, 82.41);
  // each product: litres × rate rounded once (126,918.54 + 9,743.33)
  assert.equal(petrol.amount, 126918.54);
  assert.equal(power.amount, 9743.33);
  assert.equal(u.fuelAmount, 136661.87);
  assert.equal(u.credit, 270.8);
  assert.equal(u.received, 83617 + 24034 + 30920 + 270.8);
  assert.equal(u.diff, Math.round((u.received - u.fuelAmount) * 100) / 100);
  // POS and online post to the dispenser's bank; cash counts as collected for depositing
  assert.equal(bankStatement(data, computeLedger(data), 'sbi', '2026-10-01', '2026-10-01').closing, 30920 + 24034);
  assert.equal(s.unitCash.find((x) => x.unitId === 'du1')!.collected, 83617);
  // salesman row picks up the dispenser receipts and credit
  const ram = s.salesmen.find((r) => r.salesmanId === 'ram')!;
  assert.equal(ram.card, 30920);
  assert.equal(ram.digital, 24034);
  assert.equal(ram.cashReceived, 83617);
  assert.equal(ram.credit, 270.8);
});

test('changing a nozzle product later does not rewrite earlier days', () => {
  const data = notebookDay();
  const before = computeLedger(data).summaries['2026-10-01'].fuelAmount;
  data.nozzles.find((n) => n.id === 'du1n3')!.productId = 'diesel';
  assert.equal(computeLedger(data).summaries['2026-10-01'].fuelAmount, before);
});

test('cheques reduce the balance only once cleared; credit days counted FIFO', () => {
  const data = notebookDay();
  // more credit on later days
  const d5 = newDay(data, '2026-10-05', initialCarry(data));
  d5.creditSales.push({ id: 'cs2', customerId: 'c1', unitId: 'du1', qty: 0, amount: 10000, vehicleNo: '', slipNo: '' });
  data.days[d5.date] = d5;
  data.cheques = [{ id: 'q1', customerId: 'c1', amount: 270.8, chequeNo: '000123', drawnOn: 'HDFC', chequeDate: '2026-10-06', receivedDate: '2026-10-06', status: 'pending', depositBankId: 'sbi', note: '' }];

  let st = creditStatus(data, 'c1', '2026-10-10');
  assert.equal(st.balance, 10270.8);
  assert.equal(st.pendingCheques, 270.8);
  assert.equal(st.toPay, 10000);
  assert.equal(st.oldestUnpaidDate, '2026-10-01');
  assert.equal(st.daysAvailed, 9);
  assert.equal(st.daysLeft, 21);

  // cheque cleared on 8 Oct: balance drops, oldest unpaid moves to 5 Oct
  data.cheques[0] = { ...data.cheques[0], status: 'cleared', statusDate: '2026-10-08' };
  data.days['2026-10-08'] = newDay(data, '2026-10-08', initialCarry(data));
  st = creditStatus(data, 'c1', '2026-10-10');
  assert.equal(st.balance, 10000);
  assert.equal(st.pendingCheques, 0);
  assert.equal(st.oldestUnpaidDate, '2026-10-05');
  assert.equal(st.daysAvailed, 5);
  const led = customerLedger(data, 'c1');
  assert.equal(led.balance, 10000);
  assert.match(led.rows[led.rows.length - 1].description, /Cheque #000123 cleared/);
  // cleared cheque is credited to the deposit bank on the clearing date
  const l = computeLedger(data);
  assert.equal(bankStatement(data, l, 'sbi', '2026-10-08', '2026-10-08').rows[0].credit, 270.8);
  assert.equal(l.summaries['2026-10-08'].creditRecovery, 270.8);

  // bounced cheque never counts
  data.cheques[0] = { ...data.cheques[0], status: 'bounced', statusDate: '2026-10-08' };
  assert.equal(creditStatus(data, 'c1', '2026-10-10').balance, 10270.8);

  // overdue after the credit period
  data.cheques = [];
  st = creditStatus(data, 'c1', '2026-11-05');
  assert.equal(st.daysLeft, -5);
});

test('SMS text after a credit sale', () => {
  const data = notebookDay();
  data.cheques = [{ id: 'q1', customerId: 'c1', amount: 100, chequeNo: '1', drawnOn: '', chequeDate: '', receivedDate: '2026-10-01', status: 'pending', note: '' }];
  const sale = data.days['2026-10-01'].creditSales[0];
  const msg = creditMessage(data, 'c1', '2026-10-01', sale, '2026-10-01');
  assert.match(msg, /^Test Station: Dear Sharma Transport, credit of Rs 270\.80 on Thu, 1 Oct 2026 \(Petrol 2\.50 L, vehicle MH12AB1234\)\./);
  assert.match(msg, /Total amount due: Rs 270\.80\./);
  assert.match(msg, /Cheque in clearing: Rs 100\./);
  assert.match(msg, /Balance to be paid: Rs 170\.80\./);
  assert.match(msg, /Credit availed for 0 of 30 days, 30 days left to pay\./);
});

test('balance in texts is the latest one, including payments after the credit day', () => {
  const data = notebookDay();
  const sale = data.days['2026-10-01'].creditSales[0];
  data.days['2026-10-03'] = { ...emptyDay('2026-10-03'), creditReceipts: [{ id: 'r1', customerId: 'c1', amount: 70.8, mode: 'cash', note: '' }] };
  // Credit entered later for 1 Oct, viewed on 3 Oct: shows what is owed now.
  const msg = creditMessage(data, 'c1', '2026-10-01', sale, '2026-10-03');
  assert.match(msg, /credit of Rs 270\.80 on Thu, 1 Oct 2026/);
  assert.match(msg, /Total amount due: Rs 200\./);
  assert.match(msg, /Credit availed for 2 of 30 days, 28 days left to pay\./);

  const paid = paymentMessage(data, 'c1', '2026-10-03', { kind: 'received', amount: 70.8, mode: 'cash' }, '2026-10-03');
  assert.match(paid, /^Test Station: Dear Sharma Transport, payment of Rs 70\.80 received in cash on Sat, 3 Oct 2026\./);
  assert.match(paid, /Total amount due: Rs 200\./);

  data.cheques = [{ id: 'q1', customerId: 'c1', amount: 200, chequeNo: '77', drawnOn: '', chequeDate: '', receivedDate: '2026-10-03', status: 'pending', note: '' }];
  const chq = paymentMessage(data, 'c1', '2026-10-03', { kind: 'cheque-received', amount: 200, chequeNo: '77' }, '2026-10-03');
  assert.match(chq, /cheque #77 for Rs 200 received on Sat, 3 Oct 2026\. It will be adjusted once the cheque clears\./);
  assert.match(chq, /Balance to be paid: Rs 0\./);

  data.cheques[0] = { ...data.cheques[0], status: 'cleared', statusDate: '2026-10-05' };
  const cleared = paymentMessage(data, 'c1', '2026-10-05', { kind: 'cheque-cleared', amount: 200, chequeNo: '77' }, '2026-10-05');
  assert.match(cleared, /cheque #77 for Rs 200 has cleared on Mon, 5 Oct 2026/);
  assert.match(cleared, /Nothing is due now\./);
});

test('one SMS for the day lists every vehicle filled', () => {
  const data = notebookDay();
  const day = data.days['2026-10-01'];
  day.creditSales.push({ ...day.creditSales[0], id: 'cs2', vehicleNo: 'MH12CD5678', productId: 'diesel', qty: 20, amount: 1890 });
  day.creditReceipts = [{ id: 'r1', customerId: 'c1', amount: 1000, mode: 'cash', note: '' }];
  const msg = daySummaryMessage(data, 'c1', '2026-10-01', '2026-10-01');
  const lines = msg.split('\n');
  assert.equal(lines[0], 'Test Station: Dear Sharma Transport, credit on Thu, 1 Oct 2026:');
  assert.equal(lines[1], '1. MH12AB1234 - Petrol 2.50 L - Rs 270.80');
  assert.equal(lines[2], '2. MH12CD5678 - Diesel (HSD) 20 L - Rs 1,890');
  assert.equal(lines[3], 'Credit for the day (2 fills): Rs 2,160.80.');
  assert.equal(lines[4], 'Paid on Thu, 1 Oct 2026: Rs 1,000.');
  assert.equal(lines[5], 'Total amount due: Rs 1,160.80.');
});

test('old Hi-Octane default becomes Power; renamed products are left alone', () => {
  const old = defaultData();
  old.products = old.products.map((p) => (p.id === 'hioctane' ? { ...p, name: 'Hi-Octane', active: false } : p));
  const n = normalize(old);
  const power = n.products.find((p) => p.id === 'hioctane')!;
  assert.equal(power.name, 'Power (premium)');
  assert.equal(power.active, true);
  const custom = defaultData();
  custom.products = custom.products.map((p) => (p.id === 'hioctane' ? { ...p, name: 'XP95', active: false } : p));
  assert.equal(normalize(custom).products.find((p) => p.id === 'hioctane')!.name, 'XP95');
});

test('typed bank entries carry their id so they can be deleted from the statement', () => {
  const data = notebookDay();
  data.days['2026-10-01'].bankTxns.push({ id: 'dep1', bankId: 'sbi', type: 'deposit', amount: 5000, unitId: 'du1', ref: '', note: '' });
  const l = computeLedger(data);
  const rows = bankStatement(data, l, 'sbi', '2026-10-01', '2026-10-01').rows;
  assert.equal(rows.find((r) => r.kind === 'deposit')!.txnId, 'dep1');
  assert.equal(rows.find((r) => r.kind === 'card')!.txnId, undefined);
  assert.equal(l.summaries['2026-10-01'].unitCash.find((u) => u.unitId === 'du1')!.deposits[0].txnId, 'dep1');
});

test("a day's opening meter follows the earlier day's closing unless typed by hand", () => {
  const data = defaultData();
  data.products = data.products.map((p) => (p.id === 'petrol' ? { ...p, rate: 100 } : p));
  const n = data.nozzles[0].id;
  data.days['2026-10-01'] = { ...emptyDay('2026-10-01'), readings: [{ nozzleId: n, productId: 'petrol', opening: 1000, closing: 1100, testLitres: 0 }] };
  // Next day was opened before the earlier closing was final: its stored opening is stale.
  data.days['2026-10-02'] = { ...emptyDay('2026-10-02'), readings: [{ nozzleId: n, productId: 'petrol', opening: 1000, closing: 1250, testLitres: 0 }] };
  let l = computeLedger(data);
  assert.equal(l.summaries['2026-10-02'].nozzles[0].opening, 1100);
  assert.equal(l.summaries['2026-10-02'].nozzles[0].litres, 150);
  // Correcting the earlier closing moves the next opening with it.
  data.days['2026-10-01'].readings[0].closing = 1120;
  l = computeLedger(data);
  assert.equal(l.summaries['2026-10-02'].nozzles[0].opening, 1120);
  // A typed opening (e.g. meter replaced) is kept.
  data.days['2026-10-02'].readings[0] = { ...data.days['2026-10-02'].readings[0], opening: 1200, openingManual: true };
  l = computeLedger(data);
  assert.equal(l.summaries['2026-10-02'].nozzles[0].opening, 1200);
  assert.equal(l.summaries['2026-10-02'].nozzles[0].litres, 50);
  // First day ever: no earlier closing, so the entered opening is used.
  assert.equal(l.summaries['2026-10-01'].nozzles[0].opening, 1000);
});
