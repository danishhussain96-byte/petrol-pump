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

/** True when the text is a sum to work out (has + − × ÷ beyond a leading minus sign). */
export function isExpression(s: string): boolean {
  return /[+*/x×÷()]|.-/.test(s.replace(/\s/g, '').replace(/,/g, ''));
}

/**
 * Works out a typed sum such as "2000+1500-200", "12*500" or "(100+50)/2".
 * A trailing operator is ignored while typing. Returns undefined when it can't be read.
 */
export function evalExpr(input: string): number | undefined {
  const src = input.replace(/[\s,]/g, '').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/[+\-*/(]+$/, '');
  if (!src) return undefined;
  let i = 0;
  const peek = () => src[i];
  const number = (): number | undefined => {
    const m = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i));
    if (!m) return undefined;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number | undefined => {
    if (peek() === '-') {
      i++;
      const v = factor();
      return v === undefined ? undefined : -v;
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() === ')') i++;
      return v;
    }
    return number();
  };
  const term = (): number | undefined => {
    let v = factor();
    while (v !== undefined && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = factor();
      if (r === undefined) return undefined;
      v = op === '*' ? v * r : r === 0 ? undefined : v / r;
    }
    return v;
  };
  const expr = (): number | undefined => {
    let v = term();
    while (v !== undefined && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = term();
      if (r === undefined) return undefined;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  if (v === undefined || i !== src.length) return undefined;
  return isFinite(v) ? Math.round(v * 1000) / 1000 : undefined;
}
