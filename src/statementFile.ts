// Turns an uploaded Excel / CSV statement into transactions. PDF goes through PdfReader.
import * as XLSX from 'xlsx';
import { parseRows, type ParseResult } from './statement';

export type StatementKind = 'pdf' | 'sheet' | 'text';

export function kindOf(name: string, mime?: string): StatementKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (/\.(xlsx|xlsm|xls|ods)$/.test(n) || /spreadsheet|excel/.test(mime ?? '')) return 'sheet';
  if (/\.(csv|txt|tsv)$/.test(n) || /csv|text\/plain/.test(mime ?? '')) return 'text';
  return null;
}

/** Reads every sheet and keeps the one that yields the most transactions. */
function bestSheet(wb: XLSX.WorkBook): ParseResult {
  let best: ParseResult = { lines: [], method: 'columns', warnings: ['No transactions found in this file.'] };
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const res = parseRows(rows);
    if (res.lines.length > best.lines.length) best = res;
  }
  return best;
}

/** Excel workbook (xlsx / xls / ods, or an HTML table saved as .xls), as base64. */
export function parseSpreadsheet(base64: string): ParseResult {
  return bestSheet(XLSX.read(base64, { type: 'base64', cellDates: true }));
}

/** CSV / TSV text. Values are kept as typed so dates like 02/10/2026 stay day-first. */
export function parseCsvText(text: string): ParseResult {
  return bestSheet(XLSX.read(text, { type: 'string', raw: true }));
}
