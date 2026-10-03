// Pure calculation logic (no React) — daily sales, stock, salesman settlement,
// cash in hand, bank statements and customer ledgers. Covered by tests in __tests__/.
import type { AppData, BankTxnType, Cheque, DayRecord, Product, Purchase } from './types';
import { round2, sum } from './utils';

export const DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

/** Pseudo salesman id for sales not assigned to anyone. */
export const COUNTER = '';

export type PayKind = 'card' | 'digital';

export function paymentKey(kind: PayKind, bankId: string | undefined): string {
  return `${kind}:${bankId ?? ''}`;
}

export function parsePaymentKey(key: string): { kind: PayKind; bankId: string } {
  const i = key.indexOf(':');
  return { kind: key.slice(0, i) === 'digital' ? 'digital' : 'card', bankId: key.slice(i + 1) };
}

/** Bank account a nozzle's card / digital sales go to: its unit's account, else the Settings default. */
export function payBankFor(data: AppData, kind: PayKind, nozzleId: string | undefined): string {
  const nz = nozzleId ? data.nozzles.find((n) => n.id === nozzleId) : undefined;
  const unit = nz?.unitId ? data.units.find((u) => u.id === nz.unitId) : undefined;
  const own = kind === 'card' ? unit?.cardBankId : unit?.digitalBankId;
  return own || unit?.bankId || (kind === 'card' ? data.settings.cardBankId : data.settings.digitalBankId) || '';
}

export interface UnitRow {
  unitId: string;
  litres: number;
  amount: number;
}

/** One dispenser's day sheet: sale by product and how it was paid. diff = received − sale (negative = short). */
export interface UnitSaleRow {
  unitId: string;
  salesmanId: string;
  byProduct: { productId: string; litres: number; testLitres: number; rate: number; amount: number }[];
  litres: number;
  fuelAmount: number;
  cash: number;
  online: number;
  pos: number;
  credit: number;
  received: number;
  diff: number;
}

export interface UnitDeposit {
  bankId: string;
  amount: number;
  /** Deposited into a bank other than the dispenser's own. */
  cross: boolean;
  txnId: string;
}

/** Cash of one dispenser: collected from its salesmen and deposited to bank. unitId '' = not tied to a dispenser. */
export interface UnitCashRow {
  unitId: string;
  /** Not yet deposited from earlier days. */
  opening: number;
  /** Cash received from salesmen for this dispenser's sales (split by their fuel sales on each dispenser). */
  collected: number;
  deposited: number;
  deposits: UnitDeposit[];
  /** Still to deposit, carried to the next day. */
  closing: number;
}

export interface NozzleLine {
  nozzleId: string;
  unitId: string;
  productId: string;
  salesmanId: string;
  opening: number;
  closing: number;
  testLitres: number;
  litres: number;
  rate: number;
  amount: number;
}

export interface SalesmanRow {
  salesmanId: string;
  litres: number;
  fuelAmount: number;
  itemAmount: number;
  saleAmount: number;
  credit: number;
  card: number;
  digital: number;
  cashDue: number;
  cashReceived: number;
  /** cashReceived − cashDue. Negative = short, positive = excess. */
  diff: number;
}

export interface StockRow {
  productId: string;
  opening: number;
  received: number;
  sold: number;
  book: number;
  dip?: number;
  /** dip − book. Negative = loss, positive = gain. */
  variance: number;
  closing: number;
  rate: number;
  saleAmount: number;
  costRate: number;
}

export interface BankMove {
  date: string;
  bankId: string;
  kind: BankTxnType | 'card' | 'digital' | 'receipt' | 'expense' | 'purchase';
  description: string;
  credit: number;
  debit: number;
  /** Set for bank entries typed in by the user (can be deleted); unset for ones the app derives. */
  txnId?: string;
}

export interface CashFlow {
  opening: number;
  salesCash: number;
  creditRecovery: number;
  otherIncome: number;
  bankWithdrawals: number;
  expenses: number;
  purchases: number;
  bankDeposits: number;
  /** Cash that came in on this day only: salesmen + cash from credit customers + other income. */
  receivedToday: number;
  expected: number;
  counted: number;
  hasCount: boolean;
  /** counted − expected (only meaningful when hasCount). */
  difference: number;
  closing: number;
}

export interface DaySummary {
  date: string;
  nozzles: NozzleLine[];
  units: UnitRow[];
  unitSales: UnitSaleRow[];
  unitCash: UnitCashRow[];
  stock: StockRow[];
  salesmen: SalesmanRow[];
  fuelLitres: number;
  fuelAmount: number;
  itemAmount: number;
  totalSales: number;
  card: number;
  digital: number;
  credit: number;
  creditRecovery: number;
  expenses: number;
  otherIncome: number;
  purchasesAmount: number;
  cash: CashFlow;
  bankMoves: BankMove[];
  /** Σ sold × (rate − average cost), for products whose cost is known. */
  grossMargin: number;
  /** Products sold today whose cost is not known yet (left out of the margin). */
  costUnknown: string[];
  stockGainLossValue: number;
  netProfit: number;
  shortExcess: number;
}

export interface Carry {
  stock: Record<string, number>;
  /** Running average cost per unit, by productId (0 = not known yet). */
  cost: Record<string, number>;
  /** Dispenser cash collected but not yet deposited, by unitId. */
  pending: Record<string, number>;
  cash: number;
  meters: Record<string, number>;
  /** Last closing meter entered on an earlier day, by nozzle (only real readings, not Setup openings). */
  closings?: Record<string, number>;
}

/** A day's opening meter: the previous day's closing, unless the opening was typed by hand. */
export function openingOf(r: { nozzleId: string; opening: number; openingManual?: boolean }, carry: Carry): number {
  if (r.openingManual) return r.opening || 0;
  return carry.closings?.[r.nozzleId] ?? (r.opening || 0);
}

export function rateOf(day: DayRecord, p: Product): number {
  const r = day.rates[p.id];
  return r ? r : p.rate;
}

/** Total paid for a purchase (older entries stored a per-unit rate). */
export function purchaseAmount(p: Purchase): number {
  return p.amount !== undefined ? p.amount || 0 : (p.qty || 0) * (p.rate || 0);
}

/**
 * Running (weighted) average cost per unit after receiving stock.
 * Stock whose cost is unknown (cost 0) is ignored, so the first tanker sets the cost.
 */
export function averageCost(openingQty: number, openingCost: number, receivedQty: number, receivedAmount: number): number {
  if (receivedQty <= 0) return openingCost;
  const known = openingCost > 0 ? Math.max(0, openingQty) : 0;
  return Math.round(((known * openingCost + receivedAmount) / (known + receivedQty)) * 10000) / 10000;
}

export function emptyDay(date: string): DayRecord {
  return {
    date,
    rates: {},
    costRates: {},
    readings: [],
    itemSales: [],
    purchases: [],
    dips: {},
    settlements: [],
    creditSales: [],
    creditReceipts: [],
    expenses: [],
    bankTxns: [],
    otherIncome: [],
    cashCount: {},
    looseCash: 0,
    notes: '',
    locked: false,
  };
}

export function initialCarry(data: AppData): Carry {
  const stock: Record<string, number> = {};
  const cost: Record<string, number> = {};
  for (const p of data.products) {
    stock[p.id] = p.openingStock || 0;
    cost[p.id] = p.costRate || 0;
  }
  const meters: Record<string, number> = {};
  for (const n of data.nozzles) meters[n.id] = n.openingReading || 0;
  return { stock, cost, pending: {}, cash: data.settings.openingCash || 0, meters };
}

export function countedCash(day: DayRecord): number {
  let t = day.looseCash || 0;
  for (const [d, n] of Object.entries(day.cashCount)) t += Number(d) * (n || 0);
  return t;
}

export function computeDay(data: AppData, day: DayRecord, carry: Carry): DaySummary {
  const products = new Map(data.products.map((p) => [p.id, p]));
  const nozzles = new Map(data.nozzles.map((n) => [n.id, n]));
  const rate = (pid: string) => {
    const p = products.get(pid);
    return p ? rateOf(day, p) : 0;
  };

  // ---- Nozzle meter sales
  const nozzleLines: NozzleLine[] = [];
  for (const r of day.readings) {
    const nz = nozzles.get(r.nozzleId);
    if (!nz) continue;
    const opening = openingOf(r, carry);
    const litres = Math.max(0, round2((r.closing || 0) - opening - (r.testLitres || 0)));
    const productId = r.productId || nz.productId;
    const rt = rate(productId);
    nozzleLines.push({
      nozzleId: nz.id,
      unitId: nz.unitId ?? '',
      productId,
      salesmanId: r.salesmanId || COUNTER,
      opening,
      closing: r.closing || 0,
      testLitres: r.testLitres || 0,
      litres,
      rate: rt,
      amount: round2(litres * rt),
    });
  }

  // ---- Dispensing unit totals
  const unitMap = new Map<string, UnitRow>();
  for (const l of nozzleLines) {
    const u = unitMap.get(l.unitId) || { unitId: l.unitId, litres: 0, amount: 0 };
    u.litres = round2(u.litres + l.litres);
    u.amount = round2(u.amount + l.amount);
    unitMap.set(l.unitId, u);
  }

  // ---- Salesman settlement
  const sm = new Map<string, SalesmanRow>();
  const row = (id: string): SalesmanRow => {
    let r = sm.get(id);
    if (!r) {
      r = {
        salesmanId: id,
        litres: 0,
        fuelAmount: 0,
        itemAmount: 0,
        saleAmount: 0,
        credit: 0,
        card: 0,
        digital: 0,
        cashDue: 0,
        cashReceived: 0,
        diff: 0,
      };
      sm.set(id, r);
    }
    return r;
  };
  for (const l of nozzleLines) {
    const r = row(l.salesmanId);
    r.litres += l.litres;
    r.fuelAmount += l.amount;
  }
  for (const s of day.itemSales) {
    row(s.salesmanId || COUNTER).itemAmount += round2((s.qty || 0) * rate(s.productId));
  }
  // Salesman on each dispenser that day (first assigned nozzle).
  const unitSalesman = new Map<string, string>();
  for (const l of nozzleLines) if (l.unitId && l.salesmanId && !unitSalesman.has(l.unitId)) unitSalesman.set(l.unitId, l.salesmanId);
  const creditSalesman = (c: { salesmanId?: string; unitId?: string }) => c.salesmanId || (c.unitId ? unitSalesman.get(c.unitId) : undefined) || COUNTER;
  for (const c of day.creditSales) row(creditSalesman(c)).credit += c.amount || 0;
  const unitSettlements = day.unitSettlements || {};
  for (const [unitId, us] of Object.entries(unitSettlements)) {
    const r = row(unitSalesman.get(unitId) || COUNTER);
    r.card += us.pos || 0;
    r.digital += us.online || 0;
    r.cashReceived += us.cash || 0;
  }
  for (const st of day.settlements) {
    const r = row(st.salesmanId || COUNTER);
    r.card += st.cardSales || 0;
    r.digital += st.digitalSales || 0;
    for (const [key, amount] of Object.entries(st.payments || {})) {
      if (parsePaymentKey(key).kind === 'card') r.card += amount || 0;
      else r.digital += amount || 0;
    }
    r.cashReceived += st.cashReceived || 0;
  }
  const salesmen = [...sm.values()].map((r) => {
    r.litres = round2(r.litres);
    r.fuelAmount = round2(r.fuelAmount);
    r.itemAmount = round2(r.itemAmount);
    r.saleAmount = round2(r.fuelAmount + r.itemAmount);
    r.cashDue = round2(r.saleAmount - r.credit - r.card - r.digital);
    r.diff = round2(r.cashReceived - r.cashDue);
    return r;
  });

  // ---- Dispenser sale sheet: product-wise sale vs cash / online / POS / credit
  const unitSales: UnitSaleRow[] = [];
  for (const unitId of [...new Set([...nozzleLines.map((l) => l.unitId), ...Object.keys(unitSettlements)])]) {
    if (!unitId) continue;
    const lines = nozzleLines.filter((l) => l.unitId === unitId);
    const byProduct = new Map<string, { productId: string; litres: number; testLitres: number; rate: number; amount: number }>();
    for (const l of lines) {
      const b = byProduct.get(l.productId) || { productId: l.productId, litres: 0, testLitres: 0, rate: l.rate, amount: 0 };
      b.litres = round2(b.litres + l.litres);
      b.testLitres = round2(b.testLitres + l.testLitres);
      byProduct.set(l.productId, b);
    }
    // Like the sale sheet: total litres of each product × rate, rounded once.
    for (const b of byProduct.values()) b.amount = round2(b.litres * b.rate);
    const us = unitSettlements[unitId] || { cash: 0, online: 0, pos: 0 };
    const fuelAmount = round2(sum([...byProduct.values()], (b) => b.amount));
    const credit = round2(sum(day.creditSales.filter((c) => c.unitId === unitId), (c) => c.amount));
    const received = round2((us.cash || 0) + (us.online || 0) + (us.pos || 0) + credit);
    unitSales.push({
      unitId,
      salesmanId: unitSalesman.get(unitId) ?? COUNTER,
      byProduct: [...byProduct.values()],
      litres: round2(sum(lines, (l) => l.litres)),
      fuelAmount,
      cash: us.cash || 0,
      online: us.online || 0,
      pos: us.pos || 0,
      credit,
      received,
      diff: round2(received - fuelAmount),
    });
  }

  // ---- Stock
  const soldQty: Record<string, number> = {};
  for (const l of nozzleLines) soldQty[l.productId] = (soldQty[l.productId] || 0) + l.litres;
  for (const s of day.itemSales) soldQty[s.productId] = (soldQty[s.productId] || 0) + (s.qty || 0);
  const receivedQty: Record<string, number> = {};
  const receivedAmount: Record<string, number> = {};
  for (const p of day.purchases) {
    receivedQty[p.productId] = (receivedQty[p.productId] || 0) + (p.qty || 0);
    receivedAmount[p.productId] = (receivedAmount[p.productId] || 0) + purchaseAmount(p);
  }

  const stock: StockRow[] = [];
  for (const p of data.products) {
    const opening = carry.stock[p.id] ?? p.openingStock ?? 0;
    const received = receivedQty[p.id] || 0;
    const sold = round2(soldQty[p.id] || 0);
    const hasActivity = p.active || received || sold || opening;
    if (!hasActivity) continue;
    const book = round2(opening + received - sold);
    const dip = day.dips[p.id];
    const hasDip = typeof dip === 'number' && isFinite(dip);
    const rt = rateOf(day, p);
    stock.push({
      productId: p.id,
      opening: round2(opening),
      received: round2(received),
      sold,
      book,
      dip: hasDip ? dip : undefined,
      variance: hasDip ? round2(dip - book) : 0,
      closing: hasDip ? dip : book,
      rate: rt,
      saleAmount: round2(sold * rt),
      costRate: averageCost(opening, carry.cost?.[p.id] ?? p.costRate ?? 0, received, receivedAmount[p.id] || 0),
    });
  }

  // ---- Totals
  const fuelLitres = round2(sum(nozzleLines, (l) => l.litres));
  // Same rounding as the dispenser sheets (product litres × rate per dispenser).
  const fuelAmount = round2(sum(unitSales, (u) => u.fuelAmount) + sum(nozzleLines.filter((l) => !l.unitId), (l) => l.amount));
  const itemAmount = round2(sum(day.itemSales, (s) => (s.qty || 0) * rate(s.productId)));
  const totalSales = round2(fuelAmount + itemAmount);
  const card = round2(sum(salesmen, (r) => r.card));
  const digital = round2(sum(salesmen, (r) => r.digital));
  const credit = round2(sum(day.creditSales, (c) => c.amount));
  const shortExcess = round2(sum(salesmen, (r) => r.diff));

  // ---- Cash in hand
  const cashReceipts = day.creditReceipts.filter((r) => r.mode === 'cash');
  const cashExpenses = day.expenses.filter((e) => e.mode === 'cash');
  const cashPurchases = day.purchases.filter((p) => p.payMode === 'cash');
  const cashFlow: CashFlow = {
    opening: round2(carry.cash),
    salesCash: round2(sum(salesmen, (r) => r.cashReceived)),
    creditRecovery: round2(sum(cashReceipts, (r) => r.amount)),
    otherIncome: round2(sum(day.otherIncome, (o) => o.amount)),
    bankWithdrawals: round2(sum(day.bankTxns.filter((t) => t.type === 'withdrawal'), (t) => t.amount)),
    expenses: round2(sum(cashExpenses, (e) => e.amount)),
    purchases: round2(sum(cashPurchases, purchaseAmount)),
    bankDeposits: round2(sum(day.bankTxns.filter((t) => t.type === 'deposit'), (t) => t.amount)),
    receivedToday: 0,
    expected: 0,
    counted: 0,
    hasCount: false,
    difference: 0,
    closing: 0,
  };
  cashFlow.receivedToday = round2(cashFlow.salesCash + cashFlow.creditRecovery + cashFlow.otherIncome);
  cashFlow.expected = round2(
    cashFlow.opening +
      cashFlow.salesCash +
      cashFlow.creditRecovery +
      cashFlow.otherIncome +
      cashFlow.bankWithdrawals -
      cashFlow.expenses -
      cashFlow.purchases -
      cashFlow.bankDeposits,
  );
  cashFlow.counted = round2(countedCash(day));
  cashFlow.hasCount = cashFlow.counted > 0;
  cashFlow.difference = cashFlow.hasCount ? round2(cashFlow.counted - cashFlow.expected) : 0;
  cashFlow.closing = cashFlow.hasCount ? cashFlow.counted : cashFlow.expected;

  // ---- Bank movements
  const bankMoves: BankMove[] = [];
  const mv = (m: Omit<BankMove, 'date'>) => {
    if (m.bankId && (m.credit || m.debit)) bankMoves.push({ date: day.date, ...m });
  };
  const TXN_LABEL: Record<BankTxnType, string> = {
    deposit: 'Cash deposit',
    withdrawal: 'Cash withdrawal',
    credit: 'Amount received',
    debit: 'Payment',
    charges: 'Bank charges',
    transfer: 'Transfer',
  };
  const units = new Map(data.units.map((u) => [u.id, u]));
  const bankName = (id?: string) => data.banks.find((b) => b.id === id)?.name ?? 'other account';
  for (const t of day.bankTxns) {
    if (t.type === 'transfer') {
      const extra = [t.ref, t.note].filter(Boolean).join(' · ');
      mv({ bankId: t.bankId, kind: 'transfer', description: `Transfer to ${bankName(t.toBankId)}${extra ? ' · ' + extra : ''}`, credit: 0, debit: t.amount || 0, txnId: t.id });
      if (t.toBankId)
        mv({ bankId: t.toBankId, kind: 'transfer', description: `Transfer from ${bankName(t.bankId)}${extra ? ' · ' + extra : ''}`, credit: t.amount || 0, debit: 0, txnId: t.id });
      continue;
    }
    const isCredit = t.type === 'deposit' || t.type === 'credit';
    const unit = t.type === 'deposit' && t.unitId ? units.get(t.unitId) : undefined;
    const cross = unit && unit.bankId && unit.bankId !== t.bankId ? ' (cross)' : '';
    const desc = [TXN_LABEL[t.type] + (unit ? ` · ${unit.name}${cross}` : ''), t.ref, t.note].filter(Boolean).join(' · ');
    mv({
      bankId: t.bankId,
      kind: t.type,
      description: desc,
      credit: isCredit ? t.amount || 0 : 0,
      debit: isCredit ? 0 : t.amount || 0,
      txnId: t.id,
    });
  }
  // Card / digital sales: per-bank amounts from settlements, plus the older single-account fields.
  const payTotals = new Map<string, number>();
  const addPay = (key: string, amount: number) => payTotals.set(key, (payTotals.get(key) || 0) + (amount || 0));
  for (const st of day.settlements) {
    addPay(paymentKey('card', data.settings.cardBankId), st.cardSales);
    addPay(paymentKey('digital', data.settings.digitalBankId), st.digitalSales);
    for (const [key, amount] of Object.entries(st.payments || {})) addPay(key, amount);
  }
  for (const [unitId, us] of Object.entries(unitSettlements)) {
    const nz = nozzleLines.find((l) => l.unitId === unitId)?.nozzleId ?? data.nozzles.find((n) => n.unitId === unitId)?.id;
    addPay(paymentKey('card', payBankFor(data, 'card', nz)), us.pos);
    addPay(paymentKey('digital', payBankFor(data, 'digital', nz)), us.online);
  }
  for (const [key, amount] of payTotals) {
    const { kind, bankId } = parsePaymentKey(key);
    const description = kind === 'card' ? 'Card (POS) sales' : 'Digital / online sales';
    mv({ bankId, kind, description, credit: round2(amount), debit: 0 });
  }
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  for (const r of day.creditReceipts)
    if (r.mode === 'bank' && r.bankId)
      mv({
        bankId: r.bankId,
        kind: 'receipt',
        description: `Recovery: ${customers.get(r.customerId)?.name ?? 'Customer'}${r.note ? ' · ' + r.note : ''}`,
        credit: r.amount || 0,
        debit: 0,
      });
  const chequesCleared = (data.cheques || []).filter((c) => c.status === 'cleared' && c.statusDate === day.date);
  for (const c of chequesCleared)
    if (c.depositBankId)
      mv({
        bankId: c.depositBankId,
        kind: 'receipt',
        description: `Cheque cleared: ${customers.get(c.customerId)?.name ?? 'Customer'} · #${c.chequeNo}`,
        credit: c.amount || 0,
        debit: 0,
      });
  for (const e of day.expenses)
    if (e.mode === 'bank' && e.bankId)
      mv({ bankId: e.bankId, kind: 'expense', description: `Expense: ${e.head}`, credit: 0, debit: e.amount || 0 });
  for (const p of day.purchases)
    if (p.payMode === 'bank' && p.bankId)
      mv({
        bankId: p.bankId,
        kind: 'purchase',
        description: `Purchase: ${products.get(p.productId)?.name ?? ''} ${p.qty} ${products.get(p.productId)?.unit ?? ''}${p.invoiceNo ? ' · ' + p.invoiceNo : ''}${p.supplier ? ' · ' + p.supplier : ''}`,
        credit: 0,
        debit: round2(purchaseAmount(p)),
      });

  // ---- Dispenser cash → bank
  // Each salesman's cash is split over the dispensers he worked, by his fuel sales on each;
  // lube / counter sales stay unassigned ('').
  const collected = new Map<string, number>();
  const addCollected = (u: string, v: number) => collected.set(u, (collected.get(u) || 0) + v);
  for (const [unitId, us] of Object.entries(unitSettlements)) if (us.cash) addCollected(units.has(unitId) ? unitId : '', us.cash);
  // Cash entered per salesman (older way) is split by his sales on each dispenser.
  const legacyCash = new Map<string, number>();
  for (const st of day.settlements) legacyCash.set(st.salesmanId || COUNTER, (legacyCash.get(st.salesmanId || COUNTER) || 0) + (st.cashReceived || 0));
  for (const r of salesmen) {
    const cashIn = legacyCash.get(r.salesmanId) || 0;
    if (!cashIn) continue;
    let assigned = 0;
    if (r.saleAmount > 0) {
      const byUnit = new Map<string, number>();
      for (const l of nozzleLines) if (l.salesmanId === r.salesmanId && l.unitId) byUnit.set(l.unitId, (byUnit.get(l.unitId) || 0) + l.amount);
      for (const [u, amt] of byUnit) {
        const share = round2((cashIn * amt) / r.saleAmount);
        addCollected(u, share);
        assigned += share;
      }
    }
    if (Math.abs(cashIn - assigned) >= 0.005) addCollected('', round2(cashIn - assigned));
  }
  const unitDeposits = new Map<string, UnitDeposit[]>();
  for (const t of day.bankTxns) {
    if (t.type !== 'deposit') continue;
    const u = t.unitId && units.has(t.unitId) ? t.unitId : '';
    const own = u ? units.get(u)?.bankId : undefined;
    const list = unitDeposits.get(u) ?? unitDeposits.set(u, []).get(u)!;
    list.push({ bankId: t.bankId, amount: t.amount || 0, cross: !!own && own !== t.bankId, txnId: t.id });
  }
  const unitCash: UnitCashRow[] = [];
  for (const unitId of [...data.units.map((u) => u.id), '']) {
    const opening = round2(carry.pending?.[unitId] || 0);
    const col = round2(collected.get(unitId) || 0);
    const deps = unitDeposits.get(unitId) ?? [];
    const deposited = round2(sum(deps, (d) => d.amount));
    if (!opening && !col && !deposited) continue;
    unitCash.push({ unitId, opening, collected: col, deposited, deposits: deps, closing: round2(opening + col - deposited) });
  }

  // ---- Profit
  const expenses = round2(sum(day.expenses, (e) => e.amount));
  // Products whose cost is not known yet are left out of the margin instead of counting as pure profit.
  const costed = stock.filter((s) => s.costRate > 0);
  const grossMargin = round2(sum(costed, (s) => s.sold * (s.rate - s.costRate)));
  const costUnknown = stock.filter((s) => s.costRate <= 0 && s.sold > 0).map((s) => s.productId);
  const stockGainLossValue = round2(sum(stock, (s) => s.variance * s.costRate));
  const otherIncome = round2(sum(day.otherIncome, (o) => o.amount));

  return {
    date: day.date,
    nozzles: nozzleLines,
    units: [...unitMap.values()],
    unitSales,
    unitCash,
    stock,
    salesmen,
    fuelLitres,
    fuelAmount,
    itemAmount,
    totalSales,
    card,
    digital,
    credit,
    creditRecovery: round2(sum(day.creditReceipts, (r) => r.amount) + sum(chequesCleared, (c) => c.amount)),
    expenses,
    otherIncome,
    purchasesAmount: round2(sum(day.purchases, purchaseAmount)),
    cash: cashFlow,
    bankMoves,
    grossMargin,
    costUnknown,
    stockGainLossValue,
    netProfit: round2(grossMargin + stockGainLossValue + otherIncome - expenses),
    shortExcess,
  };
}

export function nextCarry(carry: Carry, day: DayRecord, s: DaySummary): Carry {
  const stock = { ...carry.stock };
  const cost = { ...carry.cost };
  const pending = { ...(carry.pending || {}) };
  for (const u of s.unitCash) pending[u.unitId] = u.closing;
  for (const r of s.stock) {
    stock[r.productId] = r.closing;
    cost[r.productId] = r.costRate;
  }
  const meters = { ...carry.meters };
  const closings = { ...(carry.closings || {}) };
  for (const r of day.readings)
    if (r.closing) {
      meters[r.nozzleId] = r.closing;
      closings[r.nozzleId] = r.closing;
    }
  return { stock, cost, pending, cash: s.cash.closing, meters, closings };
}

export interface Ledger {
  dates: string[];
  summaries: Record<string, DaySummary>;
  /** Carry-in (opening balances) for each recorded date. */
  carryIn: Record<string, Carry>;
  final: Carry;
}

/** Runs through all recorded days in date order, carrying stock, cash and meters forward. */
export function computeLedger(data: AppData): Ledger {
  const dates = Object.keys(data.days).sort();
  const summaries: Record<string, DaySummary> = {};
  const carryIn: Record<string, Carry> = {};
  let carry = initialCarry(data);
  for (const d of dates) {
    carryIn[d] = carry;
    const s = computeDay(data, data.days[d], carry);
    summaries[d] = s;
    carry = nextCarry(carry, data.days[d], s);
  }
  return { dates, summaries, carryIn, final: carry };
}

/** Opening balances for a date that may not be recorded yet. */
export function carryFor(data: AppData, ledger: Ledger, date: string): Carry {
  if (ledger.carryIn[date]) return ledger.carryIn[date];
  let carry = initialCarry(data);
  for (const d of ledger.dates) {
    if (d >= date) break;
    carry = nextCarry(carry, data.days[d], ledger.summaries[d]);
  }
  return carry;
}

// ---------------- Bank statement ----------------

export interface StatementRow extends BankMove {
  balance: number;
}

export interface Statement {
  opening: number;
  rows: StatementRow[];
  totalCredit: number;
  totalDebit: number;
  closing: number;
}

export function bankStatement(data: AppData, ledger: Ledger, bankId: string, from: string, to: string): Statement {
  const bank = data.banks.find((b) => b.id === bankId);
  let balance = bank?.openingBalance || 0;
  const rows: StatementRow[] = [];
  let totalCredit = 0;
  let totalDebit = 0;
  let opening = balance;
  for (const d of ledger.dates) {
    if (d > to) break;
    for (const m of ledger.summaries[d].bankMoves) {
      if (m.bankId !== bankId) continue;
      balance = round2(balance + m.credit - m.debit);
      if (d < from) {
        opening = balance;
        continue;
      }
      totalCredit += m.credit;
      totalDebit += m.debit;
      rows.push({ ...m, balance });
    }
    if (d < from) opening = balance;
  }
  return { opening, rows, totalCredit: round2(totalCredit), totalDebit: round2(totalDebit), closing: balance };
}

export function bankBalance(data: AppData, ledger: Ledger, bankId: string, upto = '9999-12-31'): number {
  return bankStatement(data, ledger, bankId, upto, upto).closing;
}

// ---------------- Customer (credit) ledger ----------------

export interface CustomerRow {
  date: string;
  description: string;
  debit: number; // credit sale (customer owes more)
  credit: number; // payment received
  balance: number;
}

export function customerLedger(data: AppData, customerId: string): { rows: CustomerRow[]; balance: number } {
  const c = data.customers.find((x) => x.id === customerId);
  let balance = c?.openingBalance || 0;
  const rows: CustomerRow[] = [];
  const products = new Map(data.products.map((p) => [p.id, p]));
  const units = new Map(data.units.map((u) => [u.id, u]));
  const nozzles = new Map(data.nozzles.map((n) => [n.id, n]));
  const cleared = new Map<string, Cheque[]>();
  for (const ch of data.cheques || [])
    if (ch.customerId === customerId && ch.status === 'cleared' && ch.statusDate)
      (cleared.get(ch.statusDate) ?? cleared.set(ch.statusDate, []).get(ch.statusDate)!).push(ch);
  const dates = [...new Set([...Object.keys(data.days), ...cleared.keys()])].sort();
  for (const d of dates) {
    const day = data.days[d];
    for (const s of day?.creditSales ?? []) {
      if (s.customerId !== customerId) continue;
      balance = round2(balance + (s.amount || 0));
      const p = s.productId ? products.get(s.productId) : undefined;
      const where = [s.unitId && units.get(s.unitId)?.name, s.nozzleId && nozzles.get(s.nozzleId)?.name].filter(Boolean).join(' ');
      const desc = [p ? `${p.name} ${s.qty} ${p.unit}` : 'Credit sale', s.vehicleNo, where, s.slipNo && `Slip ${s.slipNo}`].filter(Boolean).join(' · ');
      rows.push({ date: d, description: desc, debit: s.amount || 0, credit: 0, balance });
    }
    for (const r of day?.creditReceipts ?? []) {
      if (r.customerId !== customerId) continue;
      balance = round2(balance - (r.amount || 0));
      rows.push({ date: d, description: `Received (${r.mode})${r.note ? ' · ' + r.note : ''}`, debit: 0, credit: r.amount || 0, balance });
    }
    for (const ch of cleared.get(d) ?? []) {
      balance = round2(balance - (ch.amount || 0));
      rows.push({ date: d, description: `Cheque #${ch.chequeNo} cleared${ch.drawnOn ? ' · ' + ch.drawnOn : ''}`, debit: 0, credit: ch.amount || 0, balance });
    }
  }
  return { rows, balance };
}

export interface CreditStatus {
  /** Everything the customer owes (cleared payments only). */
  balance: number;
  /** Cheques received but not yet cleared. */
  pendingCheques: number;
  /** balance − pending cheques. */
  toPay: number;
  /** Credit given on the as-of date. */
  todayCredit: number;
  /** Oldest credit not yet covered by payments (first in, first out). */
  oldestUnpaidDate?: string;
  daysAvailed: number;
  creditDays: number;
  /** creditDays − daysAvailed; negative = overdue. Undefined when there is no limit. */
  daysLeft?: number;
  overLimit: boolean;
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Customer's credit position as of a date, with days counted from the oldest unpaid credit. */
export function creditStatus(data: AppData, customerId: string, asOf: string): CreditStatus {
  const c = data.customers.find((x) => x.id === customerId);
  const firstDay = Object.keys(data.days).sort()[0];
  const debits: { date: string; amount: number }[] = [];
  if (c?.openingBalance) debits.push({ date: c.openingDate || firstDay || asOf, amount: c.openingBalance });
  let paid = 0;
  let todayCredit = 0;
  for (const d of Object.keys(data.days).sort()) {
    if (d > asOf) break;
    for (const s of data.days[d].creditSales)
      if (s.customerId === customerId) {
        debits.push({ date: d, amount: s.amount || 0 });
        if (d === asOf) todayCredit += s.amount || 0;
      }
    for (const r of data.days[d].creditReceipts) if (r.customerId === customerId) paid += r.amount || 0;
  }
  let pendingCheques = 0;
  for (const ch of data.cheques || []) {
    if (ch.customerId !== customerId) continue;
    if (ch.status === 'cleared' && ch.statusDate && ch.statusDate <= asOf) paid += ch.amount || 0;
    else if (ch.status === 'pending' || (ch.status === 'cleared' && ch.statusDate && ch.statusDate > asOf)) pendingCheques += ch.amount || 0;
  }
  const totalDebit = sum(debits, (d) => d.amount);
  const balance = round2(totalDebit - paid);
  debits.sort((a, b) => a.date.localeCompare(b.date));
  let left = paid;
  let oldestUnpaidDate: string | undefined;
  for (const d of debits) {
    if (left >= d.amount - 0.005) {
      left -= d.amount;
      continue;
    }
    oldestUnpaidDate = d.date;
    break;
  }
  const creditDays = c?.creditDays || 0;
  const daysAvailed = oldestUnpaidDate && balance > 0.005 ? Math.max(0, daysBetween(oldestUnpaidDate, asOf)) : 0;
  return {
    balance,
    pendingCheques: round2(pendingCheques),
    toPay: round2(balance - pendingCheques),
    todayCredit: round2(todayCredit),
    oldestUnpaidDate: balance > 0.005 ? oldestUnpaidDate : undefined,
    daysAvailed,
    creditDays,
    daysLeft: creditDays > 0 ? creditDays - daysAvailed : undefined,
    overLimit: !!c?.creditLimit && balance > c.creditLimit,
  };
}

// ---------------- Period report ----------------

export interface PeriodReport {
  from: string;
  to: string;
  days: number;
  totalSales: number;
  fuelLitres: number;
  fuelAmount: number;
  itemAmount: number;
  card: number;
  digital: number;
  credit: number;
  creditRecovery: number;
  expenses: number;
  otherIncome: number;
  purchasesAmount: number;
  grossMargin: number;
  stockGainLossValue: number;
  netProfit: number;
  shortExcess: number;
  byProduct: { productId: string; sold: number; amount: number; received: number; variance: number }[];
  bySalesman: SalesmanRow[];
  byUnit: UnitRow[];
  /** Per dispenser over the period: cash collected, deposited (and how much cross), still pending at the end. */
  unitCash: { unitId: string; collected: number; deposited: number; cross: number; pending: number; byBank: { bankId: string; amount: number }[] }[];
  expenseHeads: { head: string; amount: number }[];
  daily: DaySummary[];
}

export function periodReport(data: AppData, ledger: Ledger, from: string, to: string): PeriodReport {
  const daily = ledger.dates.filter((d) => d >= from && d <= to).map((d) => ledger.summaries[d]);
  const prod = new Map<string, { productId: string; sold: number; amount: number; received: number; variance: number }>();
  const sm = new Map<string, SalesmanRow>();
  const heads = new Map<string, number>();
  const units = new Map<string, UnitRow>();
  const cash = new Map<string, PeriodReport['unitCash'][number]>();
  for (const s of daily) {
    for (const u of s.unitCash) {
      const a = cash.get(u.unitId) || { unitId: u.unitId, collected: 0, deposited: 0, cross: 0, pending: 0, byBank: [] };
      a.collected = round2(a.collected + u.collected);
      a.deposited = round2(a.deposited + u.deposited);
      a.pending = u.closing;
      for (const d of u.deposits) {
        if (d.cross) a.cross = round2(a.cross + d.amount);
        const b = a.byBank.find((x) => x.bankId === d.bankId);
        if (b) b.amount = round2(b.amount + d.amount);
        else a.byBank.push({ bankId: d.bankId, amount: d.amount });
      }
      cash.set(u.unitId, a);
    }
    for (const u of s.units) {
      const a = units.get(u.unitId) || { unitId: u.unitId, litres: 0, amount: 0 };
      a.litres = round2(a.litres + u.litres);
      a.amount = round2(a.amount + u.amount);
      units.set(u.unitId, a);
    }
    for (const r of s.stock) {
      const p = prod.get(r.productId) || { productId: r.productId, sold: 0, amount: 0, received: 0, variance: 0 };
      p.sold = round2(p.sold + r.sold);
      p.amount = round2(p.amount + r.saleAmount);
      p.received = round2(p.received + r.received);
      p.variance = round2(p.variance + r.variance);
      prod.set(r.productId, p);
    }
    for (const r of s.salesmen) {
      const a = sm.get(r.salesmanId);
      if (!a) {
        sm.set(r.salesmanId, { ...r });
        continue;
      }
      for (const k of ['litres', 'fuelAmount', 'itemAmount', 'saleAmount', 'credit', 'card', 'digital', 'cashDue', 'cashReceived', 'diff'] as const)
        a[k] = round2(a[k] + r[k]);
    }
    for (const e of data.days[s.date].expenses) heads.set(e.head || 'Other', round2((heads.get(e.head || 'Other') || 0) + e.amount));
  }
  const total = (f: (s: DaySummary) => number) => round2(sum(daily, f));
  return {
    from,
    to,
    days: daily.length,
    totalSales: total((s) => s.totalSales),
    fuelLitres: total((s) => s.fuelLitres),
    fuelAmount: total((s) => s.fuelAmount),
    itemAmount: total((s) => s.itemAmount),
    card: total((s) => s.card),
    digital: total((s) => s.digital),
    credit: total((s) => s.credit),
    creditRecovery: total((s) => s.creditRecovery),
    expenses: total((s) => s.expenses),
    otherIncome: total((s) => s.otherIncome),
    purchasesAmount: total((s) => s.purchasesAmount),
    grossMargin: total((s) => s.grossMargin),
    stockGainLossValue: total((s) => s.stockGainLossValue),
    netProfit: total((s) => s.netProfit),
    shortExcess: total((s) => s.shortExcess),
    byProduct: [...prod.values()].filter((p) => p.sold || p.received || p.variance),
    bySalesman: [...sm.values()],
    byUnit: [...units.values()],
    unitCash: [...cash.values()],
    expenseHeads: [...heads.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount),
    daily,
  };
}
