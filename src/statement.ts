// Reads bank statements (rows from Excel / CSV, or positioned text from a PDF) into
// transactions, totals deposits and withdrawals, and reconciles them against the app's
// own bank movements. Pure logic (no React) — covered by __tests__/statement.test.ts.
import type { Ledger } from './calc';
import { addDays, round2, sum } from './utils';

export interface StatementLine {
  date: string; // YYYY-MM-DD
  description: string;
  credit: number; // money in (deposit)
  debit: number; // money out (withdrawal)
  balance?: number;
}

export interface ParseResult {
  lines: StatementLine[];
  /** How the layout was understood, for display. */
  method: 'columns' | 'balance';
  warnings: string[];
  openingBalance?: number;
}

// ---------------- Amounts and dates ----------------

/** Parses "1,234.50", "(1,234.50)", "1,234.50 CR", "Rs. 500", "-" … Returns null when not a number. */
export function parseAmount(raw: unknown): { value: number; side?: 'cr' | 'dr' } | null {
  if (typeof raw === 'number') return isFinite(raw) ? { value: raw } : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  let side: 'cr' | 'dr' | undefined;
  const end = s.match(/(?:^|[\d\s.)])(CR|DR)\.?$/);
  const start = s.match(/^(CR|DR)\.?\s/);
  if (end) {
    side = end[1] === 'CR' ? 'cr' : 'dr';
    s = s.replace(/\s*(CR|DR)\.?$/, '').trim();
  } else if (start) {
    side = start[1] === 'CR' ? 'cr' : 'dr';
    s = s.slice(start[0].length).trim();
  }
  s = s.replace(/^(PKR|RS\.?|INR|USD|AED|SAR)\s*/, '').replace(/\s*(PKR|RS\.?)$/, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = parseFloat(s);
  return { value: negative ? -v : v, side };
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Day-first by default (Pakistan); month-first only when the day part can't be a month. */
export function parseDate(raw: unknown): string | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : ymd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    return b > 12 && a <= 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a);
  }
  m = s.match(/^(\d{1,2})[-/.\s]?([A-Z]{3,4})[A-Z]*[-/.,\s]+'?(\d{2,4})\b/);
  if (m && MONTHS[m[2]]) return ymd(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/^([A-Z]{3,4})[A-Z]*[-/.\s]+(\d{1,2})(?:ST|ND|RD|TH)?[,\s]+(\d{4})\b/);
  if (m && MONTHS[m[1]]) return ymd(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

// ---------------- Column detection ----------------

type ColKind = 'date' | 'valueDate' | 'desc' | 'credit' | 'debit' | 'amount' | 'type' | 'balance' | 'other';

export function classifyHeader(raw: string): ColKind {
  const h = raw.toLowerCase().replace(/[^a-z/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return 'other';
  if (/\b(dr ?\/ ?cr|cr ?\/ ?dr|debit ?\/ ?credit|credit ?\/ ?debit)\b/.test(h) || h === 'type' || h === 'txn type' || h === 'transaction type') return 'type';
  if (h.includes('balance')) return 'balance';
  if (h.includes('value date')) return 'valueDate';
  if (h.includes('date')) return 'date';
  if (/\b(credit|credits|deposit|deposits|paid in|receipts?|cr|money in|inflow)\b/.test(h) && !/\bdebit|withdraw/.test(h)) return 'credit';
  if (/\b(debit|debits|withdrawal|withdrawals|paid out|payments?|dr|money out|outflow)\b/.test(h)) return 'debit';
  if (/\b(amount|amt)\b/.test(h)) return 'amount';
  if (/\b(description|particulars|narration|details|remarks|transaction|memo)\b/.test(h)) return 'desc';
  return 'other';
}

interface Columns {
  date: number;
  desc: number[];
  credit: number;
  debit: number;
  amount: number;
  type: number;
  balance: number;
}

function detectColumns(row: string[]): Columns | null {
  const kinds = row.map((c) => classifyHeader(String(c ?? '')));
  const first = (k: ColKind) => kinds.indexOf(k);
  let date = first('date');
  if (date < 0) date = first('valueDate');
  const cols: Columns = {
    date,
    desc: kinds.map((k, i) => (k === 'desc' ? i : -1)).filter((i) => i >= 0),
    credit: first('credit'),
    debit: first('debit'),
    amount: first('amount'),
    type: first('type'),
    balance: first('balance'),
  };
  if (cols.date < 0) return null;
  if ((cols.credit >= 0 && cols.debit >= 0) || cols.amount >= 0 || cols.credit >= 0) return cols;
  return null;
}

const SKIP_ROW = /\b(opening balance|closing balance|balance b\/?f|balance c\/?f|brought forward|carried forward|total|grand total)\b/i;

// ---------------- Table parsing ----------------

/** Parses statement rows (each row = cells). Finds a header row; falls back to balance-change reading. */
export function parseRows(rows: unknown[][]): ParseResult {
  const cells = rows.map((r) => r.map((c) => (c instanceof Date ? c : c === null || c === undefined ? '' : typeof c === 'number' ? c : String(c).trim())));
  for (let i = 0; i < Math.min(cells.length, 60); i++) {
    const cols = detectColumns(cells[i].map((c) => (typeof c === 'string' ? c : '')));
    if (cols) return parseWithColumns(cells.slice(i + 1), cols);
  }
  return parseByBalance(cells);
}

function text(c: unknown): string {
  return c instanceof Date ? '' : typeof c === 'number' ? String(c) : String(c ?? '');
}

function parseWithColumns(rows: unknown[][], cols: Columns): ParseResult {
  const lines: StatementLine[] = [];
  const warnings: string[] = [];
  let openingBalance: number | undefined;
  let prevBalance: number | undefined;
  let pendingSign = 0;
  for (const row of rows) {
    const date = parseDate(row[cols.date]) ?? (typeof row[cols.date] === 'number' ? excelSerialDate(row[cols.date] as number) : null);
    const desc = cols.desc.map((i) => text(row[i])).filter(Boolean).join(' ').trim() || otherText(row, cols);
    const bal = cols.balance >= 0 ? parseAmount(row[cols.balance]) : null;
    const balance = bal ? (bal.side === 'dr' ? -Math.abs(bal.value) : bal.value) : undefined;

    let credit = 0;
    let debit = 0;
    if (cols.credit >= 0 && cols.debit >= 0) {
      credit = Math.abs(parseAmount(row[cols.credit])?.value ?? 0);
      debit = Math.abs(parseAmount(row[cols.debit])?.value ?? 0);
    } else if (cols.amount >= 0 || cols.credit >= 0) {
      const a = parseAmount(row[cols.amount >= 0 ? cols.amount : cols.credit]);
      if (a && a.value !== 0) {
        const t = cols.type >= 0 ? text(row[cols.type]).toUpperCase() : '';
        let side: 'cr' | 'dr' | undefined = /^C|CR|CREDIT|DEP/.test(t) ? 'cr' : /^D|DR|DEBIT|WD/.test(t) ? 'dr' : a.side;
        if (!side && a.value < 0) side = 'dr';
        if (!side && balance !== undefined && prevBalance !== undefined) side = balance >= prevBalance ? 'cr' : 'dr';
        if (!side) {
          side = 'cr';
          pendingSign++;
        }
        if (side === 'cr') credit = Math.abs(a.value);
        else debit = Math.abs(a.value);
      }
    }

    if (!date) {
      if (SKIP_ROW.test(desc) && balance !== undefined && lines.length === 0) openingBalance = balance;
      // Continuation of the previous line's description.
      if (!credit && !debit && desc && lines.length) lines[lines.length - 1].description += ' ' + desc;
      else if ((credit || debit) && lines.length && !SKIP_ROW.test(desc)) lines.push({ date: lines[lines.length - 1].date, description: desc, credit, debit, balance });
      if (balance !== undefined) prevBalance = balance;
      continue;
    }
    if (SKIP_ROW.test(desc) && !credit && !debit) {
      if (balance !== undefined && lines.length === 0) openingBalance = balance;
      if (balance !== undefined) prevBalance = balance;
      continue;
    }
    if (!credit && !debit) continue;
    lines.push({ date, description: desc, credit: round2(credit), debit: round2(debit), balance });
    if (balance !== undefined) prevBalance = balance;
  }
  if (pendingSign) warnings.push(`${pendingSign} line(s) had no Dr/Cr marker and were taken as deposits — please check.`);
  return { lines, method: 'columns', warnings, openingBalance };
}

function otherText(row: unknown[], cols: Columns): string {
  const used = new Set([cols.date, cols.credit, cols.debit, cols.amount, cols.type, cols.balance]);
  return row
    .map((c, i) => (used.has(i) ? '' : text(c)))
    .filter((t) => t && !parseAmount(t) && !parseDate(t))
    .join(' ')
    .trim();
}

function excelSerialDate(n: number): string | null {
  if (n < 30000 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * No usable header: each line with a date and at least two amounts is read as
 * "… amount balance"; whether it's a deposit or withdrawal comes from the balance change.
 */
function parseByBalance(rows: unknown[][]): ParseResult {
  const lines: StatementLine[] = [];
  const warnings: string[] = [];
  let prevBalance: number | undefined;
  let openingBalance: number | undefined;
  let guessed = 0;
  for (const row of rows) {
    const tokens = row.flatMap((c): (string | Date)[] => (c instanceof Date ? [c] : text(c).split(/\s{2,}|\t/))).filter((t) => t !== '');
    const joined = tokens.map((t) => (t instanceof Date ? '' : String(t))).join(' ');
    const date = tokens.length ? parseDate(tokens[0]) ?? parseDate(joined) : null;
    const amounts = tokens
      .map((t) => (t instanceof Date ? null : parseAmount(String(t))))
      .filter((a, i): a is { value: number; side?: 'cr' | 'dr' } => !!a && !(i === 0 && date) && /[.,]/.test(String(tokens[i])));
    if (!date) {
      if (SKIP_ROW.test(joined) && amounts.length) {
        prevBalance = amounts[amounts.length - 1].value;
        if (!lines.length) openingBalance = prevBalance;
      } else if (lines.length && !amounts.length && joined) lines[lines.length - 1].description += ' ' + joined;
      continue;
    }
    if (SKIP_ROW.test(joined)) {
      if (amounts.length) {
        prevBalance = amounts[amounts.length - 1].value;
        if (!lines.length) openingBalance = prevBalance;
      }
      continue;
    }
    if (amounts.length < 2) continue;
    const balA = amounts[amounts.length - 1];
    const balance = balA.side === 'dr' ? -Math.abs(balA.value) : balA.value;
    const amt = Math.abs(amounts[amounts.length - 2].value);
    let isCredit: boolean;
    if (prevBalance !== undefined && Math.abs(Math.abs(balance - prevBalance) - amt) < 0.02) isCredit = balance > prevBalance;
    else if (amounts[amounts.length - 2].side) isCredit = amounts[amounts.length - 2].side === 'cr';
    else {
      isCredit = /\b(cr|credit|deposit|dep|received|transfer from|ibft in|cash in)\b/i.test(joined);
      guessed++;
    }
    const description = tokens
      .slice(1)
      .map((t) => (t instanceof Date ? '' : String(t)))
      .filter((t) => !parseAmount(t))
      .join(' ')
      .trim();
    lines.push({ date, description, credit: isCredit ? amt : 0, debit: isCredit ? 0 : amt, balance });
    prevBalance = balance;
  }
  if (guessed) warnings.push(`${guessed} line(s): deposit/withdrawal guessed from the text — please check.`);
  if (lines.length) warnings.push('Columns were not labelled; deposits and withdrawals were worked out from the balance column.');
  return { lines, method: 'balance', warnings, openingBalance };
}

// ---------------- PDF text → rows ----------------

export interface PdfItem {
  s: string; // text
  x: number;
  y: number; // PDF coordinates: larger = higher on the page
  w: number;
  p: number; // page number
}

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

/** Groups PDF text items into lines of cells (items close together become one cell). */
export function pdfLines(items: PdfItem[]): { page: number; cells: Cell[] }[] {
  const byPage = new Map<number, PdfItem[]>();
  for (const it of items) if (it.s.trim()) (byPage.get(it.p) ?? byPage.set(it.p, []).get(it.p)!).push(it);
  const out: { page: number; cells: Cell[] }[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const its = byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfItem[][] = [];
    for (const it of its) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row[0].y - it.y) <= 3) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const cells: Cell[] = [];
      for (const it of row) {
        const last = cells[cells.length - 1];
        const charW = it.s.length ? it.w / it.s.length : 4;
        if (last && it.x - last.x1 < Math.max(2.5, charW * 0.9)) {
          last.text += (it.x - last.x1 > charW * 0.25 ? ' ' : '') + it.s;
          last.x1 = Math.max(last.x1, it.x + it.w);
        } else cells.push({ text: it.s, x0: it.x, x1: it.x + it.w });
      }
      out.push({ page, cells: cells.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text) });
    }
  }
  return out;
}

/** Turns PDF text into table rows by lining cells up under the header's columns. */
export function pdfToRows(items: PdfItem[]): string[][] {
  const lines = pdfLines(items);
  let header: Cell[] | null = null;
  const rows: string[][] = [];
  for (const line of lines) {
    const texts = line.cells.map((c) => c.text);
    if (detectColumns(texts)) {
      if (!header) rows.push(texts);
      header = line.cells; // repeated header on a new page: re-anchor, don't emit
      continue;
    }
    if (!header) {
      rows.push(texts);
      continue;
    }
    const row: string[] = header.map(() => '');
    for (const c of line.cells) {
      // Column with the most horizontal overlap, else the nearest by centre.
      let best = -1;
      let bestOverlap = 0;
      header.forEach((h, i) => {
        const overlap = Math.min(c.x1, h.x1) - Math.max(c.x0, h.x0);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = i;
        }
      });
      if (best < 0) {
        const cx = (c.x0 + c.x1) / 2;
        let bestDist = Infinity;
        header.forEach((h, i) => {
          const d = Math.abs((h.x0 + h.x1) / 2 - cx);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
      }
      row[best] = row[best] ? row[best] + ' ' + c.text : c.text;
    }
    rows.push(row);
  }
  return rows;
}

export function parsePdfItems(items: PdfItem[]): ParseResult {
  const res = parseRows(pdfToRows(items));
  if (res.lines.length === 0) {
    // Header matching failed: try the balance method on whole lines.
    const loose = parseRows(pdfLines(items).map((l) => [l.cells.map((c) => c.text).join('   ')]));
    if (loose.lines.length) return loose;
  }
  return res;
}

// ---------------- Summary and reconciliation ----------------

export interface StatementSummary {
  from: string;
  to: string;
  count: number;
  totalCredit: number;
  totalDebit: number;
  depositCount: number;
  openingBalance?: number;
  closingBalance?: number;
  byDate: { date: string; credit: number; debit: number }[];
}

export function summarize(lines: StatementLine[], openingBalance?: number): StatementSummary {
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, { date: string; credit: number; debit: number }>();
  for (const l of sorted) {
    const d = byDate.get(l.date) || { date: l.date, credit: 0, debit: 0 };
    d.credit = round2(d.credit + l.credit);
    d.debit = round2(d.debit + l.debit);
    byDate.set(l.date, d);
  }
  const withBal = lines.filter((l) => l.balance !== undefined);
  return {
    from: sorted[0]?.date ?? '',
    to: sorted[sorted.length - 1]?.date ?? '',
    count: lines.length,
    totalCredit: round2(sum(lines, (l) => l.credit)),
    totalDebit: round2(sum(lines, (l) => l.debit)),
    depositCount: lines.filter((l) => l.credit > 0).length,
    openingBalance,
    closingBalance: withBal.length ? withBal[withBal.length - 1].balance : undefined,
    byDate: [...byDate.values()],
  };
}

export interface AppMove {
  date: string;
  description: string;
  credit: number;
  debit: number;
}

export interface Reconciliation {
  /** For each statement line: index of the matched app movement, or -1. */
  match: number[];
  appMoves: AppMove[];
  /** App movements in the period with no statement line. */
  unmatchedApp: number[];
  matchedCount: number;
  byDate: { date: string; statementCredit: number; appCredit: number; statementDebit: number; appDebit: number }[];
}

/** App's own bank movements for one account in a date range. */
export function appMoves(ledger: Ledger, bankId: string, from: string, to: string): AppMove[] {
  const out: AppMove[] = [];
  for (const d of ledger.dates) {
    if (d < from || d > to) continue;
    for (const m of ledger.summaries[d].bankMoves) if (m.bankId === bankId) out.push({ date: d, description: m.description, credit: m.credit, debit: m.debit });
  }
  return out;
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

/** Matches statement lines to app movements: same amount and direction, within ±3 days (closest date first). */
export function reconcile(ledger: Ledger, bankId: string, lines: StatementLine[]): Reconciliation {
  const s = summarize(lines);
  const from = s.from ? addDays(s.from, -3) : '';
  const to = s.to ? addDays(s.to, 3) : '';
  const moves = s.from ? appMoves(ledger, bankId, from, to) : [];
  const used = new Set<number>();
  const match = lines.map(() => -1);
  // Exact-date matches first, then nearby dates.
  for (const window of [0, 1, 2, 3]) {
    lines.forEach((l, li) => {
      if (match[li] >= 0) return;
      const idx = moves.findIndex(
        (m, mi) =>
          !used.has(mi) &&
          Math.abs(dayDiff(m.date, l.date)) === window &&
          ((l.credit > 0 && Math.abs(m.credit - l.credit) < 0.5) || (l.debit > 0 && Math.abs(m.debit - l.debit) < 0.5)),
      );
      if (idx >= 0) {
        used.add(idx);
        match[li] = idx;
      }
    });
  }
  const inPeriod = (d: string) => d >= s.from && d <= s.to;
  const unmatchedApp = moves.map((m, i) => i).filter((i) => !used.has(i) && inPeriod(moves[i].date));
  const dates = new Map<string, { date: string; statementCredit: number; appCredit: number; statementDebit: number; appDebit: number }>();
  const row = (d: string) => dates.get(d) ?? dates.set(d, { date: d, statementCredit: 0, appCredit: 0, statementDebit: 0, appDebit: 0 }).get(d)!;
  for (const l of lines) {
    const r = row(l.date);
    r.statementCredit = round2(r.statementCredit + l.credit);
    r.statementDebit = round2(r.statementDebit + l.debit);
  }
  for (const m of moves) {
    if (!inPeriod(m.date)) continue;
    const r = row(m.date);
    r.appCredit = round2(r.appCredit + m.credit);
    r.appDebit = round2(r.appDebit + m.debit);
  }
  return {
    match,
    appMoves: moves,
    unmatchedApp,
    matchedCount: match.filter((m) => m >= 0).length,
    byDate: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
