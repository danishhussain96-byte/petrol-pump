import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { creditStatus, rateOf } from '../calc';
import { creditMessage } from '../creditMessage';
import { useLookups } from '../hooks';
import { canSendDirect, sendSms, sendSmsDirect, sendWhatsApp } from '../sms';
import { useStore } from '../store';
import type { AppData, CreditSale, Customer, DayRecord } from '../types';
import { Btn, C, Field, HStack, Muted, NumInput, Select } from '../ui';
import { num, round2, todayStr, uid } from '../utils';

export type SmsMode = 'auto' | 'ask' | 'off';

export function smsModeOf(settings: AppData['settings']): SmsMode {
  return settings.smsMode ?? (settings.smsAfterCredit === false ? 'off' : 'auto');
}

/**
 * After a credit sale: in "auto" mode (Android) the SMS goes out by itself; otherwise asks
 * whether to open SMS / WhatsApp. `mark` records the outcome on the credit entry.
 */
export function notifyCredit(
  data: AppData,
  customerId: string,
  date: string,
  sale: CreditSale | undefined,
  mark?: (status: 'sent' | 'opened' | 'failed') => void,
) {
  if (sale && data.settings.smsTiming === 'day') return; // one summary SMS later instead
  return notifyCustomer(data, customerId, creditMessage(data, customerId, date, sale), mark);
}

/** Sends `msg` to the customer per the SMS setting (auto / ask / off). */
export async function notifyCustomer(data: AppData, customerId: string, msg: string, mark?: (status: 'sent' | 'opened' | 'failed') => void) {
  const mode = smsModeOf(data.settings);
  if (mode === 'off') return;
  const c = data.customers.find((x) => x.id === customerId);
  if (!c) return;
  if (!c.phone) {
    Alert.alert('No SMS sent', `${c.name} has no mobile number. Add it in the Credit tab.`);
    return;
  }
  if (mode === 'auto' && canSendDirect()) {
    const r = await sendSmsDirect(c.phone, msg);
    if (r.result === 'sent' || r.result === 'unknown') {
      mark?.('sent');
      return;
    }
    mark?.('failed');
    const why =
      r.result === 'no-permission'
        ? 'SMS permission was not allowed. If Android does not show the Allow button, open Settings → Apps → Petrol Pump Manager → ⋮ → Allow restricted settings, then Permissions → SMS → Allow.'
        : `The phone could not send it${r.error ? ` (${r.error})` : ''}. Check the SIM has balance / signal.`;
    Alert.alert(`SMS to ${c.name} not sent`, why, [
      { text: 'OK', style: 'cancel' },
      { text: 'Open SMS app', onPress: () => sendSms(c.phone, msg).then(() => mark?.('opened')).catch((e) => Alert.alert('Error', String(e))) },
    ]);
    return;
  }
  Alert.alert(`Send to ${c.name}?`, msg, [
    { text: 'Skip', style: 'cancel' },
    { text: 'WhatsApp', onPress: () => sendWhatsApp(c.phone, msg).then(() => mark?.('opened')).catch((e) => Alert.alert('Error', String(e))) },
    { text: 'SMS', onPress: () => sendSms(c.phone, msg).then(() => mark?.('opened')).catch((e) => Alert.alert('Error', String(e))) },
  ]);
}

/** For the 💬 buttons: send directly after a confirm on Android, or open the SMS app. */
export function resendSms(data: AppData, phone: string, name: string, msg: string, mark?: (status: 'sent' | 'opened' | 'failed') => void) {
  if (smsModeOf(data.settings) !== 'off' && canSendDirect()) {
    Alert.alert(`Send SMS to ${name}?`, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open SMS app', onPress: () => sendSms(phone, msg).then(() => mark?.('opened')).catch((e) => Alert.alert('Error', String(e))) },
      {
        text: 'Send now',
        onPress: async () => {
          const r = await sendSmsDirect(phone, msg);
          if (r.result === 'sent' || r.result === 'unknown') {
            mark?.('sent');
            Alert.alert('SMS sent', `Sent to ${name}.`);
          } else {
            mark?.('failed');
            Alert.alert('SMS not sent', r.result === 'no-permission' ? 'SMS permission was not allowed.' : r.error ?? r.result);
          }
        },
      },
    ]);
    return;
  }
  sendSms(phone, msg).then(() => mark?.('opened')).catch((e) => Alert.alert('Error', String(e)));
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
  const { data, update, updateDay } = useStore();
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

  // Balances shown are the latest (a back-dated day still shows what is owed now).
  const asOf = day.date > todayStr() ? day.date : todayStr();
  // Customers who took credit on this dispenser come first.
  const customerOptions = useMemo(() => {
    const used = new Map<string, number>();
    for (const d of Object.values(data.days))
      for (const c of d.creditSales) if (!unitId || c.unitId === unitId) used.set(c.customerId, (used.get(c.customerId) || 0) + 1);
    return data.customers
      .filter((c) => c.active)
      .sort((a, b) => (used.get(b.id) || 0) - (used.get(a.id) || 0) || a.name.localeCompare(b.name))
      .map((c) => {
        const st = creditStatus(data, c.id, asOf);
        return { value: c.id, label: c.name, sub: [c.vehicleNo, `due ${L.cur} ${num(st.balance)}`].filter(Boolean).join(' · ') };
      });
  }, [data, unitId, asOf, L.cur]);

  const customer = f.customerId ? L.customer.get(f.customerId) : undefined;
  const vehicles = (customer?.vehicleNo ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const rate = rateFor(f.productId);
  const status = f.customerId ? creditStatus(data, f.customerId, asOf) : undefined;

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
    const after: AppData = { ...data, days: { ...data.days, [day.date]: { ...day, creditSales: [...day.creditSales, sale] } } };
    notifyCredit(after, sale.customerId, day.date, sale, (status) =>
      updateDay(day.date, (d) => ({ ...d, creditSales: d.creditSales.map((x) => (x.id === sale.id ? { ...x, sms: status } : x)) })),
    );
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
          Due now {L.cur} {num(status.balance)}
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
      {smsModeOf(data.settings) !== 'off' && data.settings.smsTiming === 'day' ? (
        <Muted style={{ marginTop: 4 }}>No SMS now: send one summary of the day's fills from Station → Credit.</Muted>
      ) : smsModeOf(data.settings) === 'auto' && canSendDirect() ? (
        <Muted style={{ marginTop: 4 }}>An SMS with the balance goes to the customer automatically.</Muted>
      ) : smsModeOf(data.settings) !== 'off' ? (
        <Muted style={{ marginTop: 4 }}>You'll be asked to send the customer an SMS / WhatsApp.</Muted>
      ) : null}
    </View>
  );
}
