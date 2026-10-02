import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useLookups } from '../hooks';
import { useStore } from '../store';
import type { Cheque, CreditReceipt } from '../types';
import { Btn, Field, HStack, Muted, NumInput, Select } from '../ui';
import { isValidDate, num, prettyDate, todayStr, uid } from '../utils';

type Mode = 'cash' | 'bank' | 'cheque';

/**
 * Payment from a credit customer. Cash / bank reduce the balance at once; a cheque is kept
 * "in clearing" and only reduces the balance when marked cleared.
 */
export function ReceivePayment({ customerId: fixedCustomer, date: fixedDate, onDone }: { customerId?: string; date?: string; onDone?: () => void }) {
  const { data, update, updateDay } = useStore();
  const L = useLookups();
  const blank = {
    customerId: fixedCustomer,
    date: fixedDate ?? todayStr(),
    mode: 'cash' as Mode,
    amount: 0,
    bankId: data.banks.find((b) => b.active)?.id as string | undefined,
    chequeNo: '',
    drawnOn: '',
    chequeDate: fixedDate ?? todayStr(),
    note: '',
  };
  const [f, setF] = useState(blank);

  const save = () => {
    const date = fixedDate ?? f.date;
    if (!f.customerId) return Alert.alert('Missing', 'Select the customer.');
    if (!f.amount) return Alert.alert('Missing', 'Enter the amount.');
    if (!isValidDate(date)) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD');
    const customerId = f.customerId;
    if (f.mode === 'cheque') {
      if (!f.chequeNo.trim()) return Alert.alert('Missing', 'Enter the cheque number.');
      const ch: Cheque = {
        id: uid(),
        customerId,
        amount: f.amount,
        chequeNo: f.chequeNo.trim(),
        drawnOn: f.drawnOn.trim(),
        chequeDate: f.chequeDate,
        receivedDate: date,
        status: 'pending',
        depositBankId: f.bankId,
        note: f.note,
      };
      update((d) => ({ ...d, cheques: [...(d.cheques || []), ch] }));
      Alert.alert('Cheque recorded', `Cheque #${ch.chequeNo} for ${L.cur} ${num(ch.amount)} is in clearing. Mark it cleared in Ledgers → Credit customers when the bank clears it.`);
    } else {
      if (f.mode === 'bank' && !f.bankId) return Alert.alert('Missing', 'Select the bank account.');
      if (data.days[date]?.locked) return Alert.alert('Day is locked', `Unlock ${prettyDate(date)} first.`);
      const r: CreditReceipt = { id: uid(), customerId, amount: f.amount, mode: f.mode, bankId: f.mode === 'bank' ? f.bankId : undefined, note: f.note };
      updateDay(date, (d) => ({ ...d, creditReceipts: [...d.creditReceipts, r] }));
    }
    setF({ ...blank, customerId: fixedCustomer ?? f.customerId, date, mode: f.mode, bankId: f.bankId });
    onDone?.();
  };

  return (
    <View>
      {fixedCustomer ? null : <Select label="Customer" value={f.customerId} options={L.opt.customers} onChange={(v) => setF({ ...f, customerId: v })} />}
      {fixedDate ? null : <Field label="Date received (YYYY-MM-DD)" value={f.date} onChange={(t) => setF({ ...f, date: t })} />}
      <HStack>
        <NumInput label="Amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0 })} />
        <Select
          label="Paid by"
          value={f.mode}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'bank', label: 'Bank transfer / UPI' },
            { value: 'cheque', label: 'Cheque' },
          ]}
          onChange={(v) => setF({ ...f, mode: (v as Mode) || 'cash' })}
        />
      </HStack>
      {f.mode === 'cheque' ? (
        <>
          <HStack>
            <Field label="Cheque #" value={f.chequeNo} onChange={(t) => setF({ ...f, chequeNo: t })} />
            <Field label="Cheque date" value={f.chequeDate} onChange={(t) => setF({ ...f, chequeDate: t })} />
          </HStack>
          <Field label="Drawn on (customer's bank)" value={f.drawnOn} onChange={(t) => setF({ ...f, drawnOn: t })} />
          <Select label="Deposited in (your account)" value={f.bankId} options={L.opt.banks} allowNone="— Not yet deposited —" onChange={(v) => setF({ ...f, bankId: v })} />
          <Muted style={{ marginTop: 4 }}>The balance goes down only after you mark the cheque cleared.</Muted>
        </>
      ) : null}
      {f.mode === 'bank' ? <Select label="Received in" value={f.bankId} options={L.opt.banks} onChange={(v) => setF({ ...f, bankId: v })} /> : null}
      <Field label="Note" value={f.note} onChange={(t) => setF({ ...f, note: t })} />
      <Btn title={f.mode === 'cheque' ? 'Record cheque' : 'Save payment'} onPress={save} style={{ marginTop: 10 }} />
    </View>
  );
}
