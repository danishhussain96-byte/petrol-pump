export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateStr(parseDate(s)) === s;
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function monthStart(s: string): string {
  return s.slice(0, 8) + '01';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function prettyDate(s: string): string {
  const d = parseDate(s);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function num(n: number, digits = 2): string {
  if (!isFinite(n)) return '0';
  const fixed = Math.abs(n).toFixed(digits);
  const [int, dec] = fixed.split('.');
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmedDec = dec && /[1-9]/.test(dec) ? '.' + dec : '';
  return (n < 0 && Number(fixed) !== 0 ? '-' : '') + withCommas + trimmedDec;
}

export function money(n: number, currency = 'Rs'): string {
  return `${currency} ${num(n)}`;
}

export function sum<T>(arr: T[], f: (x: T) => number): number {
  let t = 0;
  for (const x of arr) t += f(x) || 0;
  return t;
}

export function parseNum(s: string): number {
  const v = parseFloat(s.replace(/,/g, ''));
  return isFinite(v) ? v : 0;
}
