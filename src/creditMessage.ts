// Texts sent to a credit customer: credit taken or payment received, what they owe now,
// cheques in clearing, and how many credit days are used / left.
import { creditStatus } from './calc';
import type { AppData, CreditSale } from './types';
import { num, prettyDate, todayStr } from './utils';

/** Balance is always the latest position, so a back-dated entry still shows what is owed now. */
function latest(date: string, now: string): string {
  return date > now ? date : now;
}

function balanceLines(data: AppData, customerId: string, asOf: string): string[] {
  const cur = data.settings.currency || 'Rs';
  const m = (n: number) => `${cur} ${num(n)}`;
  const st = creditStatus(data, customerId, asOf);
  const lines: string[] = [];
  if (st.balance <= 0.005) {
    lines.push(st.balance < -0.005 ? `Advance with us: ${m(-st.balance)}.` : 'Nothing is due now.');
    return lines;
  }
  lines.push(`Total amount due: ${m(st.balance)}.`);
  if (st.pendingCheques > 0.005) {
    lines.push(`Cheque in clearing: ${m(st.pendingCheques)}.`);
    lines.push(`Balance to be paid: ${m(st.toPay)}.`);
  }
  if (st.daysLeft === undefined) lines.push(`Credit availed for ${st.daysAvailed} day${st.daysAvailed === 1 ? '' : 's'}.`);
  else if (st.daysLeft >= 0)
    lines.push(`Credit availed for ${st.daysAvailed} of ${st.creditDays} days, ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left to pay.`);
  else lines.push(`Credit availed for ${st.daysAvailed} days; payment is overdue by ${-st.daysLeft} day${st.daysLeft === -1 ? '' : 's'} (limit ${st.creditDays} days).`);
  return lines;
}

function greeting(data: AppData, customerId: string): string {
  const c = data.customers.find((x) => x.id === customerId);
  return `${data.settings.stationName || 'Petrol pump'}: Dear ${c?.name ?? 'customer'}`;
}

export function creditMessage(data: AppData, customerId: string, date: string, sale?: CreditSale, now = todayStr()): string {
  const cur = data.settings.currency || 'Rs';
  const m = (n: number) => `${cur} ${num(n)}`;
  const lines: string[] = [];
  if (sale) {
    const p = sale.productId ? data.products.find((x) => x.id === sale.productId) : undefined;
    const what = [p && sale.qty ? `${p.name} ${num(sale.qty)} ${p.unit}` : '', sale.vehicleNo ? `vehicle ${sale.vehicleNo}` : ''].filter(Boolean).join(', ');
    lines.push(`${greeting(data, customerId)}, credit of ${m(sale.amount)} on ${prettyDate(date)}${what ? ` (${what})` : ''}.`);
    const dayCredit = creditStatus(data, customerId, date).todayCredit;
    if (dayCredit > sale.amount + 0.005) lines.push(`Total credit on ${prettyDate(date)}: ${m(dayCredit)}.`);
  } else {
    lines.push(`${greeting(data, customerId)}, your account as of ${prettyDate(latest(date, now))}.`);
  }
  lines.push(...balanceLines(data, customerId, latest(date, now)));
  lines.push('Thank you.');
  return lines.join('\n');
}

export type PaymentNotice =
  | { kind: 'received'; amount: number; mode: 'cash' | 'bank' }
  | { kind: 'cheque-received'; amount: number; chequeNo: string }
  | { kind: 'cheque-cleared'; amount: number; chequeNo: string }
  | { kind: 'cheque-bounced'; amount: number; chequeNo: string };

/** Text after a payment: what was paid, then what is still due. `data` must already include the payment. */
export function paymentMessage(data: AppData, customerId: string, date: string, p: PaymentNotice, now = todayStr()): string {
  const cur = data.settings.currency || 'Rs';
  const m = (n: number) => `${cur} ${num(n)}`;
  const hi = greeting(data, customerId);
  const on = prettyDate(date);
  const first =
    p.kind === 'received'
      ? `${hi}, payment of ${m(p.amount)} received ${p.mode === 'bank' ? 'by bank transfer / UPI' : 'in cash'} on ${on}.`
      : p.kind === 'cheque-received'
        ? `${hi}, cheque #${p.chequeNo} for ${m(p.amount)} received on ${on}. It will be adjusted once the cheque clears.`
        : p.kind === 'cheque-cleared'
          ? `${hi}, your cheque #${p.chequeNo} for ${m(p.amount)} has cleared on ${on} and is adjusted in your account.`
          : `${hi}, your cheque #${p.chequeNo} for ${m(p.amount)} has bounced (${on}). The amount is still due.`;
  return [first, ...balanceLines(data, customerId, latest(date, now)), 'Thank you.'].join('\n');
}
