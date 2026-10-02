// Text sent to a credit customer: today's credit, what they owe, cheques in clearing,
// and how many credit days are used / left.
import { creditStatus } from './calc';
import type { AppData, CreditSale } from './types';
import { num, prettyDate } from './utils';

export function creditMessage(data: AppData, customerId: string, date: string, sale?: CreditSale): string {
  const cur = data.settings.currency || 'Rs';
  const c = data.customers.find((x) => x.id === customerId);
  const st = creditStatus(data, customerId, date);
  const m = (n: number) => `${cur} ${num(n)}`;
  const lines: string[] = [];
  const station = data.settings.stationName || 'Petrol pump';
  if (sale) {
    const p = sale.productId ? data.products.find((x) => x.id === sale.productId) : undefined;
    const what = [p && sale.qty ? `${p.name} ${num(sale.qty)} ${p.unit}` : '', sale.vehicleNo ? `vehicle ${sale.vehicleNo}` : ''].filter(Boolean).join(', ');
    lines.push(`${station}: Dear ${c?.name ?? 'customer'}, credit of ${m(sale.amount)} on ${prettyDate(date)}${what ? ` (${what})` : ''}.`);
    if (st.todayCredit > sale.amount + 0.005) lines.push(`Total credit today: ${m(st.todayCredit)}.`);
  } else {
    lines.push(`${station}: Dear ${c?.name ?? 'customer'}, your account as of ${prettyDate(date)}.`);
  }
  lines.push(`Total amount due: ${m(st.balance)}.`);
  if (st.pendingCheques > 0.005) {
    lines.push(`Cheque in clearing: ${m(st.pendingCheques)}.`);
    lines.push(`Balance to be paid: ${m(st.toPay)}.`);
  }
  if (st.balance > 0.005) {
    if (st.daysLeft === undefined) lines.push(`Credit availed for ${st.daysAvailed} day${st.daysAvailed === 1 ? '' : 's'}.`);
    else if (st.daysLeft >= 0)
      lines.push(`Credit availed for ${st.daysAvailed} of ${st.creditDays} days, ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left to pay.`);
    else lines.push(`Credit availed for ${st.daysAvailed} days; payment is overdue by ${-st.daysLeft} day${st.daysLeft === -1 ? '' : 's'} (limit ${st.creditDays} days).`);
  }
  lines.push('Thank you.');
  return lines.join('\n');
}
