import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { creditStatus, customerLedger, type CreditStatus } from '../calc';
import { creditMessage, daySummaryMessage } from '../creditMessage';
import { useLookups } from '../hooks';
import { sendWhatsApp } from '../sms';
import { resendSms } from './CreditForm';
import { useStore } from '../store';
import type { Cheque, Customer } from '../types';
import { Btn, C, Card, Chip, Divider, Empty, Field, HStack, ListItem, Muted, NumInput, Row, Screen, Stat, confirm } from '../ui';
import { isValidDate, num, prettyDate, todayStr, uid } from '../utils';
import { ReceivePayment, notifyChequeStatus } from './ReceivePayment';

function daysText(st: CreditStatus): string {
  if (st.balance <= 0.005) return 'Nothing due';
  if (st.daysLeft === undefined) return `${st.daysAvailed} days on credit`;
  return st.daysLeft >= 0 ? `${st.daysAvailed}/${st.creditDays} days · ${st.daysLeft} left` : `OVERDUE ${-st.daysLeft} days`;
}

function daysColor(st: CreditStatus): string {
  if (st.balance <= 0.005) return C.green;
  if (st.daysLeft === undefined) return C.muted;
  return st.daysLeft < 0 ? C.red : st.daysLeft <= 3 ? C.accent : C.green;
}

export function Customers() {
  const { data } = useStore();
  const L = useLookups();
  const today = todayStr();
  const [sel, setSel] = useState<string>();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = useMemo(
    () =>
      data.customers
        .map((c) => ({ c, st: creditStatus(data, c.id, today) }))
        .sort((a, b) => {
          const ao = (a.st.daysLeft ?? 0) < 0 && a.st.balance > 0 ? 1 : 0;
          const bo = (b.st.daysLeft ?? 0) < 0 && b.st.balance > 0 ? 1 : 0;
          return bo - ao || b.st.balance - a.st.balance;
        }),
    [data, today],
  );
  if (sel && data.customers.some((c) => c.id === sel)) return <CustomerDetail id={sel} onBack={() => setSel(undefined)} />;

  const totalDue = rows.reduce((a, r) => a + r.st.balance, 0);
  const inClearing = rows.reduce((a, r) => a + r.st.pendingCheques, 0);
  const overdue = rows.filter((r) => r.st.balance > 0.005 && (r.st.daysLeft ?? 0) < 0).length;
  const shown = rows.filter(({ c }) => !q || `${c.name} ${c.vehicleNo} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Stat label="Total due" value={`${L.cur} ${num(totalDue)}`} />
        <Stat label="Cheques in clearing" value={`${L.cur} ${num(inClearing)}`} />
        <Stat label="Overdue customers" value={String(overdue)} color={overdue ? C.red : C.green} />
      </View>
      {adding ? (
        <Card title="New credit customer">
          <CustomerForm onDone={() => setAdding(false)} />
        </Card>
      ) : (
        <Btn title="+ Add credit customer" onPress={() => setAdding(true)} style={{ marginBottom: 12 }} />
      )}
      <Field value={q} onChange={setQ} placeholder="Search name / vehicle / mobile" />
      <Card title="Customers" style={{ marginTop: 10 }}>
        {shown.length === 0 ? <Empty text="No customers" /> : null}
        {shown.map(({ c, st }) => (
          <View key={c.id}>
            <ListItem
              title={c.name}
              sub={[c.vehicleNo, st.pendingCheques ? `cheque ${num(st.pendingCheques)} in clearing` : ''].filter(Boolean).join(' · ')}
              right={num(st.balance)}
              onPress={() => setSel(c.id)}
            />
            <Text style={{ color: daysColor(st), fontSize: 12, marginTop: -6, marginBottom: 6 }}>
              {daysText(st)}
              {st.overLimit ? ' · over limit' : ''}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function CustomerForm({ customer, onDone }: { customer?: Customer; onDone: () => void }) {
  const { update } = useStore();
  const [f, setF] = useState<Customer>(
    customer ?? { id: uid(), name: '', phone: '', vehicleNo: '', openingBalance: 0, openingDate: todayStr(), creditLimit: 0, creditDays: 30, active: true },
  );
  return (
    <>
      <Field label="Name / company" value={f.name} onChange={(t) => setF({ ...f, name: t })} />
      <HStack>
        <Field label="Mobile (for SMS)" value={f.phone} keyboardType="phone-pad" onChange={(t) => setF({ ...f, phone: t })} />
        <NumInput label="Credit days" value={f.creditDays ?? 0} onChange={(v) => setF({ ...f, creditDays: v ?? 0 })} style={{ maxWidth: 110 }} />
      </HStack>
      <Field label="Vehicle number(s), comma separated" value={f.vehicleNo} onChange={(t) => setF({ ...f, vehicleNo: t })} />
      <HStack>
        <NumInput label="Opening balance (owes)" value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v ?? 0 })} />
        <Field label="…since (YYYY-MM-DD)" value={f.openingDate ?? ''} onChange={(t) => setF({ ...f, openingDate: t })} />
      </HStack>
      <NumInput label="Credit limit (0 = none)" value={f.creditLimit} onChange={(v) => setF({ ...f, creditLimit: v ?? 0 })} />
      <HStack style={{ marginTop: 10 }}>
        <Btn title="Cancel" kind="secondary" onPress={onDone} />
        <Btn
          title="Save"
          style={{ flex: 1 }}
          onPress={() => {
            if (!f.name.trim()) return Alert.alert('Name required');
            if (f.openingDate && !isValidDate(f.openingDate)) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD');
            update((d) => ({
              ...d,
              customers: d.customers.some((x) => x.id === f.id) ? d.customers.map((x) => (x.id === f.id ? f : x)) : [...d.customers, f],
            }));
            onDone();
          }}
        />
      </HStack>
    </>
  );
}

function CustomerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, update, updateDay } = useStore();
  const L = useLookups();
  const today = todayStr();
  const c = data.customers.find((x) => x.id === id)!;
  const st = creditStatus(data, id, today);
  const led = customerLedger(data, id);
  const [mode, setMode] = useState<'none' | 'pay' | 'edit'>('none');
  const [clearing, setClearing] = useState<{ id: string; date: string } | null>(null);
  const cheques = (data.cheques || []).filter((x) => x.customerId === id).sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
  const msg = creditMessage(data, id, today);

  const setCheque = (ch: Cheque, patch: Partial<Cheque>) => update((d) => ({ ...d, cheques: d.cheques.map((x) => (x.id === ch.id ? { ...x, ...patch } : x)) }));

  // Ledger grouped by date, newest first, with each day's credit total.
  const byDate = new Map<string, typeof led.rows>();
  for (const r of led.rows) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  const dates = [...byDate.keys()].sort().reverse();

  return (
    <Screen>
      <Btn title="‹ All customers" kind="ghost" onPress={onBack} style={{ alignSelf: 'flex-start' }} />
      <Card title={c.name} right={<Btn title={mode === 'edit' ? 'Close' : 'Edit'} small kind="secondary" onPress={() => setMode(mode === 'edit' ? 'none' : 'edit')} />}>
        {mode === 'edit' ? (
          <CustomerForm customer={c} onDone={() => setMode('none')} />
        ) : (
          <>
            <Muted>{[c.phone || 'no mobile number', c.vehicleNo].filter(Boolean).join(' · ')}</Muted>
            <Divider />
            <Row label="Total due" value={`${L.cur} ${num(st.balance)}`} bold />
            {st.pendingCheques ? <Row label="Cheques in clearing" value={num(st.pendingCheques)} /> : null}
            {st.pendingCheques ? <Row label="Balance to be paid" value={`${L.cur} ${num(st.toPay)}`} bold /> : null}
            <Row label="Credit days" value={daysText(st)} color={daysColor(st)} bold />
            {st.oldestUnpaidDate ? <Row small label="Oldest unpaid credit" value={prettyDate(st.oldestUnpaidDate)} /> : null}
            {c.creditLimit ? <Row small label="Credit limit" value={num(c.creditLimit)} color={st.overLimit ? C.red : undefined} /> : null}
          </>
        )}
      </Card>
      <HStack style={{ marginBottom: 12 }}>
        <Btn title="💬 SMS balance" style={{ flex: 1 }} onPress={() => resendSms(data, c.phone, c.name, msg)} />
        <Btn title="WhatsApp" kind="secondary" onPress={() => sendWhatsApp(c.phone, msg).catch((e) => Alert.alert('Error', String(e)))} />
      </HStack>
      <Card title="Receive payment" right={<Btn title={mode === 'pay' ? 'Close' : '+ Payment / cheque'} small onPress={() => setMode(mode === 'pay' ? 'none' : 'pay')} />}>
        {mode === 'pay' ? <ReceivePayment customerId={id} onDone={() => setMode('none')} /> : <Muted>Cash, bank / UPI, or cheque (counts only when cleared).</Muted>}
      </Card>
      <Card title={`Cheques (${cheques.length})`}>
        {cheques.length === 0 ? <Empty text="No cheques" /> : null}
        {cheques.map((ch) => (
          <View key={ch.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#EEF2F6' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', color: C.text }}>
                #{ch.chequeNo}
                {ch.drawnOn ? ` · ${ch.drawnOn}` : ''}
              </Text>
              <Text style={{ fontWeight: '700', color: C.text }}>{num(ch.amount)}</Text>
            </View>
            <Muted>
              Received {ch.receivedDate}
              {ch.depositBankId ? ` · deposited in ${L.bankName(ch.depositBankId)}` : ''}
            </Muted>
            {ch.status === 'pending' ? (
              clearing?.id === ch.id ? (
                <HStack style={{ marginTop: 6 }}>
                  <Field label="Cleared on (YYYY-MM-DD)" value={clearing.date} onChange={(t) => setClearing({ ...clearing, date: t })} />
                  <Btn
                    title="Confirm"
                    small
                    style={{ marginBottom: 6 }}
                    onPress={() => {
                      if (!isValidDate(clearing.date)) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD');
                      setCheque(ch, { status: 'cleared', statusDate: clearing.date });
                      notifyChequeStatus(data, ch, 'cleared', clearing.date);
                      updateDay(clearing.date, (d) => d); // make sure that day exists so the bank shows the credit
                      setClearing(null);
                    }}
                  />
                </HStack>
              ) : (
                <HStack style={{ marginTop: 6, alignItems: 'center' }}>
                  <Text style={{ color: C.accent, flex: 1 }}>⏳ In clearing</Text>
                  <Btn title="✓ Cleared" small onPress={() => setClearing({ id: ch.id, date: today })} />
                  <Btn
                    title="Bounced"
                    small
                    kind="danger"
                    onPress={() => confirm(`Mark cheque #${ch.chequeNo} as bounced? The amount stays due.`, () => {
                          setCheque(ch, { status: 'bounced', statusDate: today });
                          notifyChequeStatus(data, ch, 'bounced', today);
                        },
                        'Bounced',
                      )
                    }
                  />
                </HStack>
              )
            ) : (
              <HStack style={{ marginTop: 4, alignItems: 'center' }}>
                <Text style={{ color: ch.status === 'cleared' ? C.green : C.red, flex: 1 }}>
                  {ch.status === 'cleared' ? `✓ Cleared ${ch.statusDate}` : `✗ Bounced ${ch.statusDate}`}
                </Text>
                <Btn title="Undo" small kind="ghost" onPress={() => setCheque(ch, { status: 'pending', statusDate: undefined })} />
              </HStack>
            )}
          </View>
        ))}
      </Card>
      <Card title="Account (day by day)">
        {c.openingBalance ? <Row small label={`Opening balance${c.openingDate ? ' · ' + c.openingDate : ''}`} value={num(c.openingBalance)} /> : null}
        {dates.length === 0 ? <Empty text="No credit yet" /> : null}
        {dates.map((d) => {
          const rows = byDate.get(d)!;
          const dayCredit = rows.reduce((a, r) => a + r.debit, 0);
          return (
            <View key={d} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: C.text, flex: 1 }}>{prettyDate(d)}</Text>
                <Muted>Balance {num(rows[rows.length - 1].balance)}</Muted>
                {c.phone && rows.some((r) => r.debit) ? (
                  <Text
                    style={{ paddingLeft: 10, fontSize: 16 }}
                    onPress={() => resendSms(data, c.phone, c.name, daySummaryMessage(data, id, d), (status) => updateDay(d, (x) => ({ ...x, summarySms: { ...(x.summarySms || {}), [id]: status } })))}
                  >
                    💬
                  </Text>
                ) : null}
              </View>
              {rows.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                  <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>{r.description}</Text>
                  <Text style={{ color: r.debit ? C.red : C.green, fontWeight: '600', fontSize: 13 }}>{r.debit ? `+${num(r.debit)}` : `−${num(r.credit)}`}</Text>
                </View>
              ))}
              {rows.filter((r) => r.debit).length > 1 ? <Muted>Credit this day: {num(dayCredit)}</Muted> : null}
            </View>
          );
        })}
      </Card>
      <HStack style={{ marginBottom: 12 }}>
        <Chip
          title={c.active ? 'Active' : 'Inactive'}
          active={c.active}
          onPress={() => update((d) => ({ ...d, customers: d.customers.map((x) => (x.id === id ? { ...x, active: !x.active } : x)) }))}
        />
      </HStack>
    </Screen>
  );
}
