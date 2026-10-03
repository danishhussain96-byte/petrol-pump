import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { COUNTER, purchaseAmount, type DaySummary, type Ledger, type PeriodReport, type Statement } from './calc';
import type { AppData } from './types';
import { num, prettyDate } from './utils';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function page(data: AppData, title: string, body: string): string {
  const st = data.settings;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:-apple-system,Roboto,Arial,sans-serif;color:#16202B;font-size:12px;margin:24px}
h1{font-size:18px;margin:0}h2{font-size:14px;margin:18px 0 6px;color:#0B5FA5;border-bottom:1px solid #D9E1EA;padding-bottom:3px}
.sub{color:#667685;margin:2px 0 10px}
table{width:100%;border-collapse:collapse;margin-bottom:6px}
th,td{border:1px solid #D9E1EA;padding:4px 6px;text-align:left}th{background:#F2F5F9}
td.n,th.n{text-align:right}tr.t td{font-weight:bold;background:#FAFBFD}
.day{page-break-before:always}.day:first-of-type{page-break-before:auto}
h3{font-size:13px;margin:14px 0 4px}
.neg{color:#C62828}.pos{color:#1E8E3E}
</style></head><body>
<h1>${esc(st.stationName)}</h1>
<div class="sub">${esc([st.address, st.phone].filter(Boolean).join(' · '))}</div>
<h1 style="font-size:15px">${esc(title)}</h1>
${body}
<p class="sub" style="margin-top:20px">Generated ${esc(new Date().toLocaleString())}</p>
</body></html>`;
}

function table(head: string[], rows: (string | number)[][], numericFrom = 1, totalRow = false): string {
  const th = head.map((h, i) => `<th class="${i >= numericFrom ? 'n' : ''}">${esc(h)}</th>`).join('');
  const tr = rows
    .map(
      (r, ri) =>
        `<tr class="${totalRow && ri === rows.length - 1 ? 't' : ''}">${r
          .map((c, i) => `<td class="${i >= numericFrom ? 'n' : ''}">${esc(typeof c === 'number' ? num(c) : c)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function names(data: AppData) {
  const p = new Map(data.products.map((x) => [x.id, x.name]));
  const s = new Map(data.salesmen.map((x) => [x.id, x.name]));
  const n = new Map(data.nozzles.map((x) => [x.id, x.name]));
  const b = new Map(data.banks.map((x) => [x.id, x.name]));
  const c = new Map(data.customers.map((x) => [x.id, x.name]));
  const u = new Map(data.units.map((x) => [x.id, x.name]));
  return {
    unit: (id: string) => u.get(id) ?? 'No dispenser',
    product: (id: string) => p.get(id) ?? '—',
    salesman: (id: string) => (id === COUNTER ? 'Counter' : s.get(id) ?? '—'),
    nozzle: (id: string) => n.get(id) ?? '—',
    bank: (id: string) => b.get(id) ?? '—',
    customer: (id: string) => c.get(id) ?? '—',
  };
}

const diff = (n: number) => (Math.abs(n) < 0.005 ? '0' : `${n < 0 ? 'Short' : 'Excess'} ${num(Math.abs(n))}`);

export function dayReportHtml(data: AppData, s: DaySummary): string {
  const N = names(data);
  const day = data.days[s.date];
  let b = '';
  b += '<h2>Meter readings</h2>';
  b += table(
    ['Dispenser', 'Nozzle', 'Product', 'Salesman', 'Opening', 'Closing', 'Test', 'Litres', 'Rate', 'Amount'],
    [
      ...s.nozzles.map((l) => [N.unit(l.unitId), N.nozzle(l.nozzleId), N.product(l.productId), N.salesman(l.salesmanId), l.opening, l.closing, l.testLitres, l.litres, l.rate, l.amount]),
      ['Total', '', '', '', '', '', '', s.fuelLitres, '', s.fuelAmount],
    ],
    4,
    true,
  );
  for (const u of s.unitSales) {
    b += `<h2>${esc(N.unit(u.unitId))} · ${esc(N.salesman(u.salesmanId))}</h2>`;
    b += table(
      ['Product', 'Litres', 'Test', 'Rate', 'Amount'],
      [...u.byProduct.map((x) => [N.product(x.productId), x.litres, x.testLitres, x.rate, x.amount]), ['Total sale', u.litres, '', '', u.fuelAmount]],
      1,
      true,
    );
    b += table(
      ['Cash', 'Online / UPI', 'POS', 'Credit', 'Received', 'Short / excess'],
      [[u.cash, u.online, u.pos, u.credit, u.received, diff(u.diff)]],
      0,
    );
  }
  b += '<h2>Salesman settlement</h2>';
  b += table(
    ['Salesman', 'Litres', 'Sale', 'Credit', 'Card', 'Digital', 'Cash due', 'Received', 'Short/Excess'],
    [
      ...s.salesmen.map((r) => [N.salesman(r.salesmanId), r.litres, r.saleAmount, r.credit, r.card, r.digital, r.cashDue, r.cashReceived, diff(r.diff)]),
      ['Total', s.fuelLitres, s.totalSales, s.credit, s.card, s.digital, s.salesmen.reduce((a, r) => a + r.cashDue, 0), s.cash.salesCash, diff(s.shortExcess)],
    ],
    1,
    true,
  );
  b += '<h2>Stock</h2>';
  b += table(
    ['Product', 'Opening', 'Received', 'Sold', 'Book', 'Dip', 'Gain/Loss', 'Closing', 'Avg cost'],
    s.stock.map((r) => [N.product(r.productId), r.opening, r.received, r.sold, r.book, r.dip === undefined ? '—' : r.dip, r.variance, r.closing, r.costRate || '—']),
  );
  if (day?.purchases.length) {
    b += '<h2>Stock received</h2>';
    b += table(
      ['Product', 'Invoice qty', 'Received', 'Amount', 'Cost / unit', 'Supplier', 'Paid'],
      day.purchases.map((p) => [N.product(p.productId), p.invoiceQty ?? p.qty, p.qty, purchaseAmount(p), p.qty ? purchaseAmount(p) / p.qty : 0, [p.supplier, p.invoiceNo].filter(Boolean).join(' '), p.payMode]),
      1,
    );
  }
  if (day?.creditSales.length || day?.creditReceipts.length) {
    b += '<h2>Credit</h2>';
    b += table(
      ['Customer', 'Detail', 'Sale', 'Received'],
      [
        ...day.creditSales.map((c) => [N.customer(c.customerId), [c.vehicleNo, c.slipNo].filter(Boolean).join(' '), c.amount, '']),
        ...day.creditReceipts.map((r) => [N.customer(r.customerId), r.mode, '', r.amount]),
      ],
      2,
    );
  }
  if (day?.expenses.length) {
    b += '<h2>Expenses</h2>';
    b += table(['Head', 'Mode', 'Note', 'Amount'], [...day.expenses.map((e) => [e.head, e.mode, e.note, e.amount]), ['Total', '', '', s.expenses]], 3, true);
  }
  if (s.unitCash.length) {
    b += '<h2>Dispenser cash → bank</h2>';
    b += table(
      ['Dispenser', 'Pending b/f', 'Collected', 'Deposited', 'Where', 'Pending c/f'],
      s.unitCash.map((u) => [
        u.unitId ? N.unit(u.unitId) : 'Not tied to a dispenser',
        u.opening,
        u.collected,
        u.deposited,
        u.deposits.map((d) => `${N.bank(d.bankId)}${d.cross ? ' (cross)' : ''}`).join(', '),
        u.closing,
      ]),
      1,
    );
  }
  if (s.bankMoves.length) {
    b += '<h2>Bank</h2>';
    b += table(['Bank', 'Description', 'Credit', 'Debit'], s.bankMoves.map((m) => [N.bank(m.bankId), m.description, m.credit, m.debit]), 2);
  }
  const c = s.cash;
  b += '<h2>Cash</h2>';
  b += table(
    ['Cash received today', 'Amount'],
    [['From salesmen', c.salesCash], ['From credit customers', c.creditRecovery], ['Other income', c.otherIncome], ['Total cash received today', c.receivedToday]],
    1,
    true,
  );
  b += table(
    ['Cash in hand (incl. earlier days)', 'Amount'],
    [
      ['Cash not banked from earlier days', c.opening],
      ['+ Cash from salesmen', c.salesCash],
      ['+ Credit recovery (cash)', c.creditRecovery],
      ['+ Other income', c.otherIncome],
      ['+ Bank withdrawals', c.bankWithdrawals],
      ['− Expenses', c.expenses],
      ['− Purchases (cash)', c.purchases],
      ['− Bank deposits', c.bankDeposits],
      ['Expected cash', c.expected],
      ...(c.hasCount ? [['Counted cash', c.counted], ['Difference', diff(c.difference)]] : []),
    ],
  );
  b += '<h2>Profit (estimate)</h2>';
  b += table(
    ['Item', 'Amount'],
    [
      ['Gross margin', s.grossMargin],
      ['Stock gain/loss', s.stockGainLossValue],
      ['Other income', s.otherIncome],
      ['Expenses', -s.expenses],
      ['Net profit', s.netProfit],
    ],
    1,
    true,
  );
  if (day?.notes) b += `<h2>Notes</h2><p>${esc(day.notes)}</p>`;
  return page(data, `Daily Report — ${prettyDate(s.date)}`, b);
}

/** One dispenser's day: meters, sale, money received, credit, payments taken there, cash → bank. */
function dispenserSection(data: AppData, s: DaySummary, unitId: string): string {
  const N = names(data);
  const day = data.days[s.date];
  const u = s.unitSales.find((x) => x.unitId === unitId);
  const meters = s.nozzles.filter((l) => l.unitId === unitId);
  const credits = (day?.creditSales ?? []).filter((c) => c.unitId === unitId);
  const receipts = (day?.creditReceipts ?? []).filter((r) => r.unitId === unitId);
  const cash = s.unitCash.find((x) => x.unitId === unitId);
  let b = `<h2>${esc(N.unit(unitId))}${u?.salesmanId && u.salesmanId !== COUNTER ? ' · Salesman: ' + esc(N.salesman(u.salesmanId)) : ''}</h2>`;
  if (!meters.length && !u && !credits.length && !receipts.length) return b + '<p class="sub">No entries.</p>';
  if (meters.length) b += '<h3>Meter readings</h3>' + table(
    ['Nozzle', 'Product', 'Opening', 'Closing', 'Test', 'Litres', 'Rate', 'Amount'],
    meters.map((l) => [N.nozzle(l.nozzleId), N.product(l.productId), l.opening, l.closing, l.testLitres, l.litres, l.rate, l.amount]),
    2,
  );
  if (u) {
    b += '<h3>Sale</h3>';
    b += table(
      ['Product', 'Litres', 'Test', 'Rate', 'Amount'],
      [...u.byProduct.map((x) => [N.product(x.productId), x.litres, x.testLitres, x.rate, x.amount]), ['Total sale', u.litres, '', '', u.fuelAmount]],
      1,
      true,
    );
    b += '<h3>Money received</h3>';
    b += table(
      ['Item', 'Amount'],
      [['Cash', u.cash], ['Online / UPI', u.online], ['POS (card)', u.pos], ['Credit', u.credit], ['Total received', u.received], ['Sale', u.fuelAmount], ['Short / excess', diff(u.diff)]],
    );
  }
  if (credits.length) {
    b += `<h3>Credit (${credits.length})</h3>`;
    b += table(
      ['Customer', 'Vehicle', 'Nozzle', 'Product', 'Litres', 'Amount'],
      [
        ...credits.map((c) => [N.customer(c.customerId), [c.vehicleNo, c.slipNo && `slip ${c.slipNo}`].filter(Boolean).join(' '), c.nozzleId ? N.nozzle(c.nozzleId) : '', c.productId ? N.product(c.productId) : '', c.qty || '', c.amount]),
        ['Total', '', '', '', '', credits.reduce((a, c) => a + (c.amount || 0), 0)],
      ],
      4,
      true,
    );
  }
  if (receipts.length) {
    b += '<h3>Payments received from credit customers</h3>';
    b += table(['Customer', 'Mode', 'Amount'], receipts.map((r) => [N.customer(r.customerId), r.mode === 'bank' ? `Bank: ${N.bank(r.bankId ?? '')}` : 'Cash', r.amount]), 2);
  }
  if (cash) {
    b += '<h3>Cash → bank</h3>';
    b += table(
      ['Item', 'Amount'],
      [
        ['Pending from earlier', cash.opening],
        ['+ Cash today', cash.collected],
        ...cash.deposits.map((d) => [`− Deposited in ${N.bank(d.bankId)}${d.cross ? ' (cross)' : ''}`, d.amount]),
        ['Still to deposit', cash.closing],
      ],
    );
  }
  return b;
}

/**
 * Dispenser-wise daily sales for each recorded date from `from` to `to`, one page per date.
 * `unitIds` limits it to some dispensers (default: all that are active or used that day).
 */
export function dispenserReportHtml(data: AppData, ledger: Ledger, from: string, to: string, unitIds?: string[]): string {
  const N = names(data);
  const dates = Object.keys(data.days).filter((d) => d >= from && d <= to).sort();
  let b = '';
  for (const date of dates) {
    const s = ledger.summaries[date];
    if (!s) continue;
    const ids = unitIds?.length
      ? unitIds
      : [...new Set([...data.units.filter((x) => x.active).map((x) => x.id), ...s.unitSales.map((x) => x.unitId)])].filter(Boolean);
    b += `<div class="day">${from === to ? '' : `<h1 style="font-size:15px;margin-top:10px">${esc(prettyDate(date))}</h1>`}`;
    if (ids.length > 1) {
      const rows = ids.map((id) => {
        const u = s.unitSales.find((x) => x.unitId === id);
        const credit = (data.days[date]?.creditSales ?? []).filter((c) => c.unitId === id).reduce((a, c) => a + (c.amount || 0), 0);
        return [N.unit(id), u?.litres ?? 0, u?.fuelAmount ?? 0, u?.cash ?? 0, u?.online ?? 0, u?.pos ?? 0, u?.credit ?? credit, diff(u?.diff ?? 0)];
      });
      const tot = (i: number) => rows.reduce((a, r) => a + (r[i] as number), 0);
      b += '<h2>All dispensers</h2>';
      b += table(['Dispenser', 'Litres', 'Sale', 'Cash', 'Online', 'POS', 'Credit', 'Short / excess'], [...rows, ['Total', tot(1), tot(2), tot(3), tot(4), tot(5), tot(6), '']], 1, true);
    }
    for (const id of ids) b += dispenserSection(data, s, id);
    b += '</div>';
  }
  if (!b) b = '<p class="sub">No entries for these dates.</p>';
  const one = unitIds?.length === 1 ? ` — ${N.unit(unitIds[0])}` : '';
  return page(data, `Dispenser-wise sales${one} — ${from === to ? prettyDate(from) : `${prettyDate(from)} to ${prettyDate(to)}`}`, b);
}

export function periodReportHtml(data: AppData, r: PeriodReport): string {
  const N = names(data);
  let b = '';
  b += '<h2>Summary</h2>';
  b += table(
    ['Item', 'Amount'],
    [
      ['Days recorded', String(r.days)],
      ['Fuel sold (L)', r.fuelLitres],
      ['Fuel sales', r.fuelAmount],
      ['Lube / item sales', r.itemAmount],
      ['Total sales', r.totalSales],
      ['Credit sales', r.credit],
      ['Card sales', r.card],
      ['Digital sales', r.digital],
      ['Credit recovery', r.creditRecovery],
      ['Purchases', r.purchasesAmount],
      ['Expenses', r.expenses],
      ['Salesman short/excess', diff(r.shortExcess)],
      ['Gross margin', r.grossMargin],
      ['Stock gain/loss', r.stockGainLossValue],
      ['Net profit', r.netProfit],
    ],
  );
  b += '<h2>Product-wise</h2>';
  b += table(['Product', 'Received', 'Sold', 'Amount', 'Gain/Loss'], r.byProduct.map((p) => [N.product(p.productId), p.received, p.sold, p.amount, p.variance]));
  if (r.byUnit.length) {
    b += '<h2>Dispenser-wise</h2>';
    b += table(['Dispenser', 'Litres', 'Amount'], r.byUnit.map((x) => [N.unit(x.unitId), x.litres, x.amount]));
  }
  if (r.unitCash.length) {
    b += '<h2>Dispenser cash → bank</h2>';
    b += table(
      ['Dispenser', 'Collected', 'Deposited', 'Cross', 'By bank', 'Pending'],
      r.unitCash.map((u) => [
        u.unitId ? N.unit(u.unitId) : 'Not tied to a dispenser',
        u.collected,
        u.deposited,
        u.cross,
        u.byBank.map((x) => `${N.bank(x.bankId)} ${num(x.amount)}`).join(', '),
        u.pending,
      ]),
      1,
    );
  }
  b += '<h2>Salesman-wise</h2>';
  b += table(
    ['Salesman', 'Litres', 'Sale', 'Credit', 'Card', 'Digital', 'Received', 'Short/Excess'],
    r.bySalesman.map((x) => [N.salesman(x.salesmanId), x.litres, x.saleAmount, x.credit, x.card, x.digital, x.cashReceived, diff(x.diff)]),
  );
  if (r.expenseHeads.length) {
    b += '<h2>Expenses by head</h2>';
    b += table(['Head', 'Amount'], r.expenseHeads.map((e) => [e.head, e.amount]));
  }
  b += '<h2>Day-wise</h2>';
  b += table(
    ['Date', 'Litres', 'Sales', 'Expenses', 'Short/Excess', 'Cash closing', 'Profit'],
    r.daily.map((d) => [d.date, d.fuelLitres, d.totalSales, d.expenses, d.shortExcess, d.cash.closing, d.netProfit]),
  );
  return page(data, `Report ${prettyDate(r.from)} – ${prettyDate(r.to)}`, b);
}

export function statementHtml(data: AppData, bankId: string, from: string, to: string, st: Statement): string {
  const bank = data.banks.find((b) => b.id === bankId);
  const b = table(
    ['Date', 'Description', 'Credit', 'Debit', 'Balance'],
    [
      [from, 'Opening balance', '', '', st.opening],
      ...st.rows.map((r) => [r.date, r.description, r.credit || '', r.debit || '', r.balance]),
      ['', 'Total / closing', st.totalCredit, st.totalDebit, st.closing],
    ],
    2,
    true,
  );
  return page(data, `Bank statement — ${bank?.name ?? ''} ${bank?.accountNo ?? ''} (${from} to ${to})`, b);
}

export async function shareHtml(html: string, name: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ html });
  }
}

export function shareDayReport(data: AppData, s: DaySummary): Promise<void> {
  return shareHtml(dayReportHtml(data, s), `Daily report ${s.date}`);
}
