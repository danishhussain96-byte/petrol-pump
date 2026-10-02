import { emptyDay, type Carry } from './calc';
import type { AppData, DayRecord, DispensingUnit, Nozzle } from './types';

export const UNIT_COUNT = 3;
export const NOZZLES_PER_UNIT = 4;
/** Default product per nozzle position on a unit: two petrol, two diesel. */
const NOZZLE_PRODUCTS = ['petrol', 'petrol', 'diesel', 'diesel'];

/** Builds a dispensing unit with its four nozzles. */
export function makeUnit(n: number, id = `du${n}`): { unit: DispensingUnit; nozzles: Nozzle[] } {
  const unit: DispensingUnit = { id, name: `Dispenser ${n}`, active: true };
  const nozzles = NOZZLE_PRODUCTS.slice(0, NOZZLES_PER_UNIT).map((productId, i) => ({
    id: `${id}n${i + 1}`,
    name: `D${n}-N${i + 1}`,
    productId,
    unitId: id,
    openingReading: 0,
    active: true,
  }));
  return { unit, nozzles };
}

function defaultLayout(): { units: DispensingUnit[]; nozzles: Nozzle[] } {
  const built = Array.from({ length: UNIT_COUNT }, (_, i) => makeUnit(i + 1));
  return { units: built.map((b) => b.unit), nozzles: built.flatMap((b) => b.nozzles) };
}

/** The four nozzles shipped in v1.0.0, before dispensing units existed. */
function isOldDefaultNozzles(nozzles: Nozzle[]): boolean {
  return (
    nozzles.length === 4 &&
    nozzles.every((n, i) => n.id === `n${i + 1}` && n.name === `Nozzle ${i + 1}` && !n.openingReading)
  );
}

export function defaultData(): AppData {
  return {
    version: 1,
    settings: {
      stationName: 'My Petrol Pump',
      address: '',
      phone: '',
      currency: 'Rs',
      openingCash: 0,
      pin: '',
    },
    products: [
      { id: 'petrol', name: 'Petrol', unit: 'L', isFuel: true, rate: 0, costRate: 0, openingStock: 0, capacity: 0, minStock: 0, active: true },
      { id: 'diesel', name: 'Diesel (HSD)', unit: 'L', isFuel: true, rate: 0, costRate: 0, openingStock: 0, capacity: 0, minStock: 0, active: true },
      { id: 'hioctane', name: 'Hi-Octane', unit: 'L', isFuel: true, rate: 0, costRate: 0, openingStock: 0, capacity: 0, minStock: 0, active: false },
      { id: 'mobiloil', name: 'Engine Oil', unit: 'pcs', isFuel: false, rate: 0, costRate: 0, openingStock: 0, capacity: 0, minStock: 0, active: true },
    ],
    ...defaultLayout(),
    salesmen: [],
    banks: [],
    customers: [],
    days: {},
  };
}

/** A fresh day with today's rates and nozzle openings carried from the previous closing. */
export function newDay(data: AppData, date: string, carry: Carry): DayRecord {
  const day = emptyDay(date);
  // Snapshot sale rates so a later rate change doesn't rewrite past days.
  // A rate of 0 means "not set yet", so it keeps following the product rate.
  for (const p of data.products) if (p.rate) day.rates[p.id] = p.rate;
  day.readings = data.nozzles
    .filter((n) => n.active)
    .map((n) => {
      const opening = carry.meters[n.id] ?? n.openingReading ?? 0;
      return { nozzleId: n.id, opening, closing: 0, testLitres: 0 };
    });
  return day;
}

/** Fills missing fields so backups from older versions load safely. */
export function normalize(raw: unknown): AppData {
  const base = defaultData();
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppData>;
  const days: AppData['days'] = {};
  for (const [k, v] of Object.entries(d.days || {})) days[k] = { ...emptyDay(k), ...v, date: k };

  // Data from before dispensing units existed.
  let units = Array.isArray(d.units) ? d.units : undefined;
  let nozzles = Array.isArray(d.nozzles) ? d.nozzles : base.nozzles;
  if (!units) {
    if (Object.keys(days).length === 0 && isOldDefaultNozzles(nozzles)) {
      // Untouched starter nozzles: switch to the 3 units × 4 nozzles layout.
      ({ units, nozzles } = defaultLayout());
    } else {
      // Real readings exist: keep every nozzle and put them on one unit.
      units = [{ id: 'du1', name: 'Dispenser 1', active: true }];
      nozzles = nozzles.map((n) => ({ ...n, unitId: n.unitId ?? 'du1' }));
    }
  }
  return {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    products: Array.isArray(d.products) ? d.products : base.products,
    units,
    nozzles,
    salesmen: Array.isArray(d.salesmen) ? d.salesmen : [],
    banks: Array.isArray(d.banks) ? d.banks : [],
    customers: Array.isArray(d.customers) ? d.customers : [],
    days,
  };
}
