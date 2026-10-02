import { emptyDay, type Carry } from './calc';
import type { AppData, DayRecord } from './types';

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
    nozzles: [
      { id: 'n1', name: 'Nozzle 1', productId: 'petrol', openingReading: 0, active: true },
      { id: 'n2', name: 'Nozzle 2', productId: 'petrol', openingReading: 0, active: true },
      { id: 'n3', name: 'Nozzle 3', productId: 'diesel', openingReading: 0, active: true },
      { id: 'n4', name: 'Nozzle 4', productId: 'diesel', openingReading: 0, active: true },
    ],
    salesmen: [],
    banks: [],
    customers: [],
    days: {},
  };
}

/** A fresh day with today's rates and nozzle openings carried from the previous closing. */
export function newDay(data: AppData, date: string, carry: Carry): DayRecord {
  const day = emptyDay(date);
  for (const p of data.products) {
    day.rates[p.id] = p.rate;
    day.costRates[p.id] = p.costRate;
  }
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
  return {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    products: Array.isArray(d.products) ? d.products : base.products,
    nozzles: Array.isArray(d.nozzles) ? d.nozzles : base.nozzles,
    salesmen: Array.isArray(d.salesmen) ? d.salesmen : [],
    banks: Array.isArray(d.banks) ? d.banks : [],
    customers: Array.isArray(d.customers) ? d.customers : [],
    days,
  };
}
