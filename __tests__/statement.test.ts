import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseAmount, parseDate, parsePdfItems, parseRows, reconcile, summarize, type PdfItem } from '../src/statement';
import { parseCsvText, parseSpreadsheet } from '../src/statementFile';
import { computeLedger, initialCarry } from '../src/calc';
import { defaultData, newDay } from '../src/defaults';

test('amounts', () => {
  assert.deepEqual(parseAmount('1,234.50'), { value: 1234.5, side: undefined });
  assert.deepEqual(parseAmount('1,234.50 CR'), { value: 1234.5, side: 'cr' });
  assert.deepEqual(parseAmount('500.00Dr'), { value: 500, side: 'dr' });
  assert.equal(parseAmount('(2,000.00)')!.value, -2000);
  assert.equal(parseAmount('Rs. 750')!.value, 750);
  assert.equal(parseAmount('PKR 1,00,000.00')!.value, 100000);
  assert.equal(parseAmount('-'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('IBFT'), null);
});

test('dates are day-first unless impossible', () => {
  assert.equal(parseDate('02/10/2026'), '2026-10-02');
  assert.equal(parseDate('02-10-26'), '2026-10-02');
  assert.equal(parseDate('10/25/2026'), '2026-10-25');
  assert.equal(parseDate('02-Oct-2026'), '2026-10-02');
  assert.equal(parseDate('02 OCT 2026 10:15:33'), '2026-10-02');
  assert.equal(parseDate('2-Sept-26'), '2026-09-02');
  assert.equal(parseDate('Oct 2, 2026'), '2026-10-02');
  assert.equal(parseDate('2026-10-02'), '2026-10-02');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('Opening Balance'), null);
});

test('HBL-style: separate Debit / Credit columns, multi-line descriptions, opening balance row', () => {
  const rows = [
    ['Account Statement'],
    ['Account No', '0123-4567'],
    ['Date', 'Value Date', 'Description', 'Cheque No', 'Debit', 'Credit', 'Balance'],
    ['', '', 'Opening Balance', '', '', '', '450,000.00'],
    ['01/10/2026', '01/10/2026', 'CASH DEPOSIT', '', '', '500,000.00', '950,000.00'],
    ['', '', 'BRANCH 0123 SLIP 88', '', '', '', ''],
    ['01/10/2026', '01/10/2026', 'POS SETTLEMENT', '', '', '14,850.00', '964,850.00'],
    ['02/10/2026', '02/10/2026', 'CHQ PAID PSO', '000123', '3,060,000.00', '', '-2,095,150.00'],
    ['', '', 'Closing Balance', '', '', '', '-2,095,150.00'],
    ['', '', 'Total', '', '3,060,000.00', '514,850.00', ''],
  ];
  const r = parseRows(rows);
  assert.equal(r.method, 'columns');
  assert.equal(r.lines.length, 3);
  assert.equal(r.openingBalance, 450000);
  assert.deepEqual(r.lines[0], { date: '2026-10-01', description: 'CASH DEPOSIT BRANCH 0123 SLIP 88', credit: 500000, debit: 0, balance: 950000 });
  const s = summarize(r.lines, r.openingBalance);
  assert.equal(s.totalCredit, 514850);
  assert.equal(s.totalDebit, 3060000);
  assert.equal(s.depositCount, 2);
  assert.equal(s.closingBalance, -2095150);
  assert.deepEqual(s.byDate, [
    { date: '2026-10-01', credit: 514850, debit: 0 },
    { date: '2026-10-02', credit: 0, debit: 3060000 },
  ]);
});

test('single Amount column with Dr/Cr column', () => {
  const rows = [
    ['Txn Date', 'Particulars', 'Amount', 'Dr/Cr', 'Balance'],
    ['03-Oct-2026', 'Cash Dep', '200,000.00', 'CR', '1,200,000.00 CR'],
    ['03-Oct-2026', 'Bank charges', '150.00', 'DR', '1,199,850.00 CR'],
  ];
  const r = parseRows(rows);
  assert.deepEqual(r.lines.map((l) => [l.credit, l.debit]), [[200000, 0], [0, 150]]);
});

test('single signed Amount column', () => {
  const r = parseRows([
    ['Date', 'Narration', 'Amount', 'Balance'],
    ['2026-10-04', 'IBFT IN', '25000', '125000'],
    ['2026-10-04', 'ATM WDL', '-5000', '120000'],
  ]);
  assert.deepEqual(r.lines.map((l) => [l.credit, l.debit]), [[25000, 0], [0, 5000]]);
});

test('no labelled columns: deposits / withdrawals from balance changes', () => {
  const r = parseRows([
    ['Opening Balance   100,000.00'],
    ['05/10/2026   CASH DEPOSIT SLIP 12   50,000.00   150,000.00'],
    ['05/10/2026   CHEQUE 7781   20,000.00   130,000.00'],
  ]);
  assert.equal(r.method, 'balance');
  assert.deepEqual(r.lines.map((l) => [l.date, l.credit, l.debit]), [['2026-10-05', 50000, 0], ['2026-10-05', 0, 20000]]);
});

test('Excel workbook with real date cells and numbers', () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Transaction Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'],
    [new Date(2026, 9, 6), 'Cash deposit', '', 300000, 800000],
    [new Date(2026, 9, 7), 'Online transfer', 12000, '', 788000],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary sheet']]), 'Info');
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const r = parseSpreadsheet(b64);
  assert.deepEqual(r.lines.map((l) => [l.date, l.credit, l.debit]), [['2026-10-06', 300000, 0], ['2026-10-07', 0, 12000]]);
});

test('CSV keeps day-first dates', () => {
  const r = parseCsvText('Date,Description,Debit,Credit,Balance\n02/10/2026,"CASH DEPOSIT, BR 12",,"1,000.00","5,000.00"\n');
  assert.deepEqual(r.lines, [{ date: '2026-10-02', description: 'CASH DEPOSIT, BR 12', credit: 1000, debit: 0, balance: 5000 }]);
});

test('PDF text items lined up under header columns, header repeated on page 2', () => {
  const it = (s: string, x: number, y: number, p = 1): PdfItem => ({ s, x, y, w: s.length * 5, p });
  const header = (p: number, y: number) => [it('Date', 40, y, p), it('Description', 110, y, p), it('Debit', 330, y, p), it('Credit', 410, y, p), it('Balance', 490, y, p)];
  const items: PdfItem[] = [
    it('MY BANK LIMITED', 40, 800),
    ...header(1, 700),
    it('01/10/2026', 40, 680), it('CASH', 110, 680), it('DEPOSIT', 135, 680), it('500,000.00', 405, 680), it('950,000.00', 485, 680),
    it('01/10/2026', 40, 665), it('ATM WITHDRAWAL', 110, 665), it('5,000.00', 335, 665), it('945,000.00', 485, 665),
    ...header(2, 760),
    it('02/10/2026', 40, 740, 2), it('IBFT FROM KHAN', 110, 740, 2), it('25,000.00', 410, 740, 2), it('970,000.00', 485, 740, 2),
  ];
  const r = parsePdfItems(items);
  assert.deepEqual(r.lines.map((l) => [l.date, l.description, l.credit, l.debit]), [
    ['2026-10-01', 'CASH DEPOSIT', 500000, 0],
    ['2026-10-01', 'ATM WITHDRAWAL', 0, 5000],
    ['2026-10-02', 'IBFT FROM KHAN', 25000, 0],
  ]);
});

test('reconcile statement against app bank movements', () => {
  const data = defaultData();
  data.banks = [{ id: 'hbl', name: 'HBL', accountNo: '', openingBalance: 0, active: true }];
  const d1 = newDay(data, '2026-10-01', initialCarry(data));
  d1.bankTxns.push({ id: 'a', bankId: 'hbl', type: 'deposit', amount: 500000, ref: '', note: '' });
  d1.bankTxns.push({ id: 'b', bankId: 'hbl', type: 'deposit', amount: 70000, ref: '', note: '' }); // not on statement
  data.days[d1.date] = d1;
  const d2 = newDay(data, '2026-10-03', initialCarry(data));
  d2.bankTxns.push({ id: 'c', bankId: 'hbl', type: 'charges', amount: 150, ref: '', note: '' });
  data.days[d2.date] = d2;
  const ledger = computeLedger(data);
  const lines = [
    { date: '2026-10-01', description: 'CASH DEPOSIT', credit: 500000, debit: 0 },
    { date: '2026-10-02', description: 'POS', credit: 14850, debit: 0 }, // not in app
    { date: '2026-10-02', description: 'CHARGES', credit: 0, debit: 150 }, // app has it a day later
  ];
  const rec = reconcile(ledger, 'hbl', lines);
  assert.equal(rec.matchedCount, 2);
  assert.equal(rec.match[1], -1);
  assert.equal(rec.unmatchedApp.length, 1);
  assert.equal(rec.appMoves[rec.unmatchedApp[0]].credit, 70000);
  assert.deepEqual(rec.byDate.find((r) => r.date === '2026-10-01'), { date: '2026-10-01', statementCredit: 500000, appCredit: 570000, statementDebit: 0, appDebit: 0 });
});
