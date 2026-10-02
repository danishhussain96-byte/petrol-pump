import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { creditStatus, rateOf } from '../calc';
import { creditMessage } from '../creditMessage';
import { useLookups } from '../hooks';
import { sendSms, sendWhatsApp } from '../sms';
import { useStore } from '../store';
import type { AppData, CreditSale, Customer, DayRecord } from '../types';
import { Btn, C, Field, HStack, Muted, NumInput, Select } from '../ui';
import { num, round2, todayStr, uid } from '../utils';

/** Asks whether to text the customer, with the message built from the data as it will be after saving. */
export function offerCreditSms(data: AppData, customerId: string, date: string, sale?: CreditSale) {
  const c = data.customers.find((x) => x.id === customerId);
  if (!c) return;
  const msg = creditMessage(data, customerId, date, sale);
  if (!c.phone) {
    Alert.alert('Saved', `${c.name} has no mobile number, so no SMS. Add it in Setup → Customers.`);
    return;
  }
  Alert.alert(`Send to ${c.name}?`, msg, [
    { text: 'Skip', style: 'cancel' },
    { text: 'WhatsApp', onPress: () => sendWhatsApp(c.phone, msg).catch((e) => Alert.alert('Error', String(e))) },
    { text: 'SMS', onPress: () => sendSms(c.phone, msg).catch((e) => Alert.alert('Error', String(e))) },
  ]);
}

export function firstVehicle(c?: Customer): string {
  return (c?.vehicleNo ?? '').split(',')[0].trim();
}

/**
 * Credit (udhaar) entry. With unitId it is tied to that dispenser and lets you pick the nozzle;
 * product and rate come from that nozzle.
 */
export function CreditForm({
  day,
  set,
  unitId,
  onDone,
}: {
  day: DayRecord;
  set: (fn: (d: DayRecord) => DayRecord) => void;
  unitId?: string;
  onDone?: () => void;
}) {
  const { data, update } = useStore();
  const L = useLookups();
  const unitNozzles = useMemo(() => data.nozzles.filter((n) => unitId && n.unitId === unitId && n.active), [data.nozzles, unitId]);
  const productOfNozzle = (nozzleId?: string) => {
    const r = day.readings.find((x) => x.nozzleId === nozzleId);
    return r?.productId || L.nozzle.get(nozzleId ?? '')?.productId;
  };
  const rateFor = (pid?: string) => {
    const p = pid ? L.product.get(pid) : undefined;
    return p ? rateOf(day, p) : 0;
  };
  const [f, setF] = useState({
    customerId: undefined as string | undefined,
    nozzleId: unitNozzles[0]?.id as string | undefined,
    productId: productOfNozzle(unitNozzles[0]?.id) as string | undefined,
    qty: 0,
    amount: 0,
    vehicleNo: '',
    slipNo: '',
  });
  const [newCust, setNewCust] = useState<{ name: string; phone: string; vehicleNo: string; creditDays: number } | null>(null);

  // Customers who took credit on this dispenser come first.
  const customerOptions = useMemo(() => {
    const used = new Map<string, number>();
    for (const d of Object.values(data.days))
      for (const c of d.creditSales) if (!unitId || c.unitId === unitId) used.set(c.customerId, (used.get(c.customerId) || 0) + 1);
    return data.customers
      .filter((c) => c.active)
      .sort((a, b) => (used.get(b.id) || 0) - (used.get(a.id) || 0) || a.name.localeCompare(b.name))
      .map((c) => {
        const st = creditStatus(data, c.id, day.date);
        return { value: c.id, label: c.name, sub: [c.vehicleNo, `due ${L.cur} ${num(st.balance)}`].filter(Boolean).join(' · ') };
      });
  }, [data, unitId, day.date, L.cur]);

  const customer = f.customerId ? L.customer.get(f.customerId) : undefined;
  const vehicles = (customer?.vehicleNo ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const rate = rateFor(f.productId);
  const status = f.customerId ? creditStatus(data, f.customerId, day.date) : undefined;

  const saveNewCustomer = () => {
    if (!newCust?.name.trim()) return Alert.alert('Name required');
    const c: Customer = {
      id: uid(),
      name: newCust.name.trim(),
      phone: newCust.phone.trim(),
      vehicleNo: newCust.vehicleNo.trim(),
      openingBalance: 0,
      creditLimit: 0,
      creditDays: newCust.creditDays || 0,
      active: true,
    };
    update((d) => ({ ...d, customers: [...d.customers, c] }));
    setF({ ...f, customerId: c.id, vehicleNo: firstVehicle(c) });
    setNewCust(null);
  };

  const add = () => {
    if (!f.customerId || !f.amount) return Alert.alert('Missing', 'Select the customer and enter litres or amount.');
    if (day.locked) return Alert.alert('Day is locked', 'Unlock this day from Station → Summary to make changes.');
    const salesmanId = unitId ? day.readings.find((r) => L.nozzle.get(r.nozzleId)?.unitId === unitId && r.salesmanId)?.salesmanId : undefined;
    const sale: CreditSale = {
      id: uid(),
      customerId: f.customerId,
      unitId,
      nozzleId: unitId ? f.nozzleId : undefined,
      productId: f.productId,
      qty: f.qty,
      amount: f.amount,
      vehicleNo: f.vehicleNo,
      slipNo: f.slipNo,
      ...(salesmanId ? { salesmanId } : {}),
    };
    set((d) => ({ ...d, creditSales: [...d.creditSales, sale] }));
    if (data.settings.smsAfterCredit !== false) {
      const after: AppData = { ...data, days: { ...data.days, [day.date]: { ...day, creditSales: [...day.creditSales, sale] } } };
      offerCreditSms(after, sale.customerId, day.date, sale);
    }
    setF({ ...f, qty: 0, amount: 0, slipNo: '' });
    onDone?.();
  };

  if (newCust) {
    return (
      <View>
        <Text style={{ fontWeight: '700', color: C.text }}>New credit customer</Text>
        <Field label="Name / company" value={newCust.name} onChange={(t) => setNewCust({ ...newCust, name: t })} />
        <HStack>
          <Field label="Mobile (for SMS)" value={newCust.phone} keyboardType="phone-pad" onChange={(t) => setNewCust({ ...newCust, phone: t })} />
          <NumInput label="Credit days" value={newCust.creditDays} onChange={(v) => setNewCust({ ...newCust, creditDays: v ?? 0 })} style={{ maxWidth: 110 }} />
        </HStack>
        <Field label="Vehicle number(s), comma separated" value={newCust.vehicleNo} onChange={(t) => setNewCust({ ...newCust, vehicleNo: t })} />
        <HStack style={{ marginTop: 10 }}>
          <Btn title="Cancel" kind="secondary" onPress={() => setNewCust(null)} />
          <Btn title="Save customer" style={{ flex: 1 }} onPress={saveNewCustomer} />
        </HStack>
      </View>
    );
  }

  return (
    <View>
      <HStack>
        <Select
          label="Customer"
          value={f.customerId}
          options={customerOptions}
          onChange={(v) => setF({ ...f, customerId: v, vehicleNo: firstVehicle(v ? L.customer.get(v) : undefined) })}
        />
        <Btn title="+ New" kind="secondary" small onPress={() => setNewCust({ name: '', phone: '', vehicleNo: '', creditDays: 30 })} style={{ marginBottom: 6 }} />
      </HStack>
      {status ? (
        <Muted style={{ marginTop: 4 }}>
          Due {L.cur} {num(status.balance)}
          {status.pendingCheques ? ` · cheque in clearing ${num(status.pendingCheques)}` : ''}
          {status.daysLeft !== undefined ? ` · ${status.daysLeft >= 0 ? `${status.daysLeft} days left` : `overdue ${-status.daysLeft} days`}` : ''}
          {status.overLimit ? ' · ⚠ over credit limit' : ''}
        </Muted>
      ) : null}
      {unitId ? (
        <Select
          label="Nozzle"
          value={f.nozzleId}
          options={unitNozzles.map((n) => ({ value: n.id, label: n.name, sub: L.productName(productOfNozzle(n.id)) }))}
          onChange={(v) => {
            const pid = productOfNozzle(v);
            const r = rateFor(pid);
            setF({ ...f, nozzleId: v, productId: pid, amount: f.qty ? round2(f.qty * r) : f.amount });
          }}
        />
      ) : (
        <Select
          label="Product"
          value={f.productId}
          options={L.opt.products}
          allowNone="— Any —"
          onChange={(v) => setF({ ...f, productId: v, amount: f.qty ? round2(f.qty * rateFor(v)) : f.amount })}
        />
      )}
      <HStack>
        <NumInput
          label={`Litres${rate ? ` (@ ${num(rate)})` : ''}`}
          value={f.qty}
          onChange={(v) => setF({ ...f, qty: v ?? 0, amount: rate ? round2((v ?? 0) * rate) : f.amount })}
        />
        <NumInput label="Amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0, qty: rate ? round2((v ?? 0) / rate) : f.qty })} />
      </HStack>
      <HStack>
        {vehicles.length > 1 ? (
          <Select label="Vehicle" value={f.vehicleNo} options={vehicles.map((v) => ({ value: v, label: v }))} onChange={(v) => setF({ ...f, vehicleNo: v ?? '' })} />
        ) : (
          <Field label="Vehicle #" value={f.vehicleNo} onChange={(t) => setF({ ...f, vehicleNo: t })} />
        )}
        <Field label="Slip #" value={f.slipNo} onChange={(t) => setF({ ...f, slipNo: t })} />
      </HStack>
      <Btn title="Save credit" onPress={add} style={{ marginTop: 10 }} />
      {data.settings.smsAfterCredit !== false ? <Muted style={{ marginTop: 4 }}>You'll be asked to send the customer an SMS / WhatsApp.</Muted> : null}
    </View>
  );
}

export function useTodayStatus(customerId?: string) {
  const { data } = useStore();
  return customerId ? creditStatus(data, customerId, todayStr()) : undefined;
}
