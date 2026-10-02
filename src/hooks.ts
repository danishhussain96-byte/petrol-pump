import { useMemo } from 'react';
import type { Option } from './ui';
import { useStore } from './store';
import { COUNTER } from './calc';

export function useLookups() {
  const { data } = useStore();
  return useMemo(() => {
    const product = new Map(data.products.map((p) => [p.id, p]));
    const salesman = new Map(data.salesmen.map((p) => [p.id, p]));
    const bank = new Map(data.banks.map((p) => [p.id, p]));
    const customer = new Map(data.customers.map((p) => [p.id, p]));
    const nozzle = new Map(data.nozzles.map((p) => [p.id, p]));
    const unit = new Map(data.units.map((p) => [p.id, p]));
    const unitName = (id?: string) => (id && unit.get(id)?.name) || 'No dispenser';
    const productName = (id?: string) => (id && product.get(id)?.name) || '—';
    const salesmanName = (id?: string) => (id === COUNTER || !id ? 'Counter / Unassigned' : salesman.get(id)?.name || 'Unknown');
    const bankName = (id?: string) => (id && bank.get(id)?.name) || '—';
    const customerName = (id?: string) => (id && customer.get(id)?.name) || '—';
    const nozzleName = (id?: string) => (id && nozzle.get(id)?.name) || '—';
    const opt = {
      products: data.products.filter((p) => p.active).map<Option>((p) => ({ value: p.id, label: p.name, sub: `${p.unit} · rate ${p.rate}` })),
      items: data.products.filter((p) => p.active && !p.isFuel).map<Option>((p) => ({ value: p.id, label: p.name, sub: `rate ${p.rate}` })),
      salesmen: data.salesmen.filter((p) => p.active).map<Option>((p) => ({ value: p.id, label: p.name })),
      units: data.units.filter((p) => p.active).map<Option>((p) => ({ value: p.id, label: p.name })),
      banks: data.banks.filter((p) => p.active).map<Option>((p) => ({ value: p.id, label: p.name, sub: p.accountNo })),
      customers: data.customers.filter((p) => p.active).map<Option>((p) => ({ value: p.id, label: p.name, sub: p.vehicleNo })),
    };
    return { product, salesman, bank, customer, nozzle, unit, unitName, productName, salesmanName, bankName, customerName, nozzleName, opt, cur: data.settings.currency };
  }, [data]);
}
