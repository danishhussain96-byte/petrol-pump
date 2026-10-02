import type { StatementLine } from './statement';

// Core data model for the Petrol Pump Manager app.
// All money values are in the station currency (default "Rs"), quantities in litres for fuel
// or units (pcs / cans) for lubricants and other items.

export type PayMode = 'cash' | 'bank' | 'credit';

export interface Settings {
  stationName: string;
  address: string;
  phone: string;
  currency: string;
  /** Cash in hand before the first recorded day. */
  openingCash: number;
  /** Default bank account for card (POS) sales when a dispensing unit has none. */
  cardBankId?: string;
  /** Default bank account for digital / online sales when a dispensing unit has none. */
  digitalBankId?: string;
  /** Optional 4–6 digit PIN to lock the app. Empty = no lock. */
  pin: string;
  /** Notes / coins used in the cash count, largest first. */
  denominations?: number[];
  /** Older on/off switch for credit SMS; replaced by smsMode. */
  smsAfterCredit?: boolean;
  /** After a credit sale: send SMS by itself (Android), ask first, or don't send. */
  smsMode?: 'auto' | 'ask' | 'off';
}

export interface Product {
  id: string;
  name: string;
  /** 'L' for fuel, anything else for packed items (pcs, can, box) */
  unit: string;
  /** Fuel products are sold through nozzles; others are sold as counter items. */
  isFuel: boolean;
  /** Current sale price per unit. A snapshot is stored on each day. */
  rate: number;
  /**
   * Cost per unit of the opening stock (optional). After that the app keeps a running
   * average cost from each purchase's total amount ÷ quantity.
   */
  costRate: number;
  /** Stock before the first recorded day. */
  openingStock: number;
  /** Tank capacity / reorder reference (optional). */
  capacity: number;
  /** Alert when book stock falls below this level. */
  minStock: number;
  active: boolean;
}

/** A dispensing unit (dispenser / machine) holding several nozzles. */
export interface DispensingUnit {
  id: string;
  name: string;
  /** Main bank account of this dispenser: its cash is deposited here. Also the default for card / digital. */
  bankId?: string;
  /** Bank account its card (POS) machine pays into. Falls back to the dispenser's bank, then Settings. */
  cardBankId?: string;
  /** Bank account its digital / online payments go to. Falls back to the dispenser's bank, then Settings. */
  digitalBankId?: string;
  active: boolean;
}

export interface Nozzle {
  id: string;
  name: string;
  productId: string;
  unitId?: string;
  /** Meter reading before the first recorded day. */
  openingReading: number;
  active: boolean;
}

export interface Salesman {
  id: string;
  name: string;
  phone: string;
  active: boolean;
}

export interface BankAccount {
  id: string;
  name: string;
  accountNo: string;
  openingBalance: number;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  /** Mobile number for SMS / WhatsApp. */
  phone: string;
  /** One or more vehicle numbers, comma separated. */
  vehicleNo: string;
  /** Amount receivable before the first recorded day. */
  openingBalance: number;
  /** Date the opening balance dates from (YYYY-MM-DD), for credit-day counting. */
  openingDate?: string;
  creditLimit: number;
  /** Days allowed to pay; 0 = no limit. */
  creditDays?: number;
  active: boolean;
}

export type ChequeStatus = 'pending' | 'cleared' | 'bounced';

/** Cheque received from a credit customer. It reduces the customer's balance only once cleared. */
export interface Cheque {
  id: string;
  customerId: string;
  amount: number;
  chequeNo: string;
  /** Bank the cheque is drawn on. */
  drawnOn: string;
  chequeDate: string;
  receivedDate: string;
  status: ChequeStatus;
  /** Date it cleared / bounced. */
  statusDate?: string;
  /** Own account it was deposited into (gets the credit when cleared). */
  depositBankId?: string;
  note: string;
}

export interface NozzleReading {
  nozzleId: string;
  /** Product on this nozzle that day (snapshot, so changing a nozzle's product later doesn't rewrite history). */
  productId?: string;
  salesmanId?: string;
  opening: number;
  closing: number;
  /** Litres pumped for testing / returned to tank — not counted as sales. */
  testLitres: number;
}

/** Counter sale of a non-fuel product (lube, filters, etc.) */
export interface ItemSale {
  id: string;
  productId: string;
  qty: number;
  salesmanId?: string;
}

/** Stock received, e.g. one tanker. */
export interface Purchase {
  id: string;
  productId: string;
  /** Quantity actually received into the tank (litres / units). Drives stock. */
  qty: number;
  /** Quantity on the invoice / bilty, when different from what was received. */
  invoiceQty?: number;
  /** Total amount paid for this tanker / lot. Cost per litre = amount ÷ qty. */
  amount?: number;
  /** Older entries stored a per-unit rate instead of a total amount. */
  rate: number;
  supplier: string;
  invoiceNo: string;
  payMode: PayMode;
  bankId?: string;
}

export interface SalesmanSettlement {
  salesmanId: string;
  cardSales: number;
  digitalSales: number;
  /** Cash actually handed over by the salesman. */
  cashReceived: number;
  /**
   * Card / digital amounts split by bank account, keyed `card:<bankId>` or `digital:<bankId>`
   * (empty bankId = not posted to any bank). cardSales / digitalSales above are the older
   * single-account fields and post to the Settings accounts.
   */
  payments?: Record<string, number>;
}

export interface CreditSale {
  id: string;
  customerId: string;
  salesmanId?: string;
  /** Dispenser / nozzle the fuel was given from. */
  unitId?: string;
  nozzleId?: string;
  productId?: string;
  qty: number;
  amount: number;
  vehicleNo: string;
  slipNo: string;
  /** Credit SMS to the customer: sent automatically, opened in the SMS app, or failed. */
  sms?: 'sent' | 'opened' | 'failed';
}

export interface CreditReceipt {
  id: string;
  customerId: string;
  amount: number;
  mode: 'cash' | 'bank';
  bankId?: string;
  /** Dispenser page it was entered on (for the list there; the money still counts as station cash / bank). */
  unitId?: string;
  sms?: 'sent' | 'opened' | 'failed';
  note: string;
}

export interface Expense {
  id: string;
  head: string;
  amount: number;
  mode: 'cash' | 'bank';
  bankId?: string;
  /** Dispenser page it was entered on (for the list there; the money still counts as station cash / bank). */
  unitId?: string;
  sms?: 'sent' | 'opened' | 'failed';
  note: string;
}

export type BankTxnType = 'deposit' | 'withdrawal' | 'credit' | 'debit' | 'charges' | 'transfer';

/**
 * Manual bank transactions.
 * deposit    — cash from the station deposited into bank (cash ↓, bank ↑)
 * withdrawal — cash withdrawn from bank into the station (cash ↑, bank ↓)
 * credit     — other money received in bank (transfer in, profit) — no cash effect
 * debit      — other payment from bank (cheque, transfer out) — no cash effect
 * charges    — bank charges / taxes deducted — no cash effect
 * transfer   — moved from bankId to toBankId (between own accounts) — no cash effect
 */
export interface BankTxn {
  id: string;
  bankId: string;
  type: BankTxnType;
  amount: number;
  /** Deposit: the dispenser whose cash this is. Into another dispenser's bank = cross deposit. */
  unitId?: string;
  /** Transfer: the receiving account. */
  toBankId?: string;
  ref: string;
  note: string;
}

/** Other cash income (e.g. tyre shop rent, service station). */
export interface OtherIncome {
  id: string;
  head: string;
  amount: number;
  note: string;
}

/** Money handed over for one dispenser's sale (credit comes from the credit entries). */
export interface UnitSettlement {
  cash: number;
  /** Online / UPI / bank transfer. */
  online: number;
  pos: number;
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  /** Sale price snapshot for the day, keyed by productId. */
  rates: Record<string, number>;
  /** No longer used: cost is the running average from purchases. Kept for old data. */
  costRates: Record<string, number>;
  readings: NozzleReading[];
  itemSales: ItemSale[];
  purchases: Purchase[];
  /** Physical dip / counted closing stock keyed by productId (optional). */
  dips: Record<string, number | undefined>;
  settlements: SalesmanSettlement[];
  /** Receipts per dispenser, keyed by unitId. */
  unitSettlements?: Record<string, UnitSettlement>;
  creditSales: CreditSale[];
  creditReceipts: CreditReceipt[];
  expenses: Expense[];
  bankTxns: BankTxn[];
  otherIncome: OtherIncome[];
  /** Physical cash count: denomination → number of notes/coins. */
  cashCount: Record<string, number>;
  /** Free amount for loose coins not covered by denominations. */
  looseCash: number;
  notes: string;
  locked: boolean;
}

/** A bank statement file uploaded by the user, kept for comparison with the app's records. */
export interface SavedStatement {
  id: string;
  bankId: string;
  fileName: string;
  importedAt: string; // ISO time
  lines: StatementLine[];
  openingBalance?: number;
  warnings: string[];
}

export interface AppData {
  version: 1;
  settings: Settings;
  products: Product[];
  units: DispensingUnit[];
  nozzles: Nozzle[];
  salesmen: Salesman[];
  banks: BankAccount[];
  customers: Customer[];
  days: Record<string, DayRecord>;
  statements: SavedStatement[];
  cheques: Cheque[];
}
