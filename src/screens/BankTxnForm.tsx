import React, { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { useLookups } from '../hooks';
import { useStore } from '../store';
import type { BankTxn, BankTxnType } from '../types';
import { Btn, C, Field, HStack, NumInput, Select } from '../ui';
import { isValidDate, todayStr, uid } from '../utils';

export const TXN_TYPES: { value: BankTxnType; label: string; sub: string }[] = [
  { value: 'deposit', label: 'Cash deposit', sub: 'Cash in hand → bank' },
  { value: 'withdrawal', label: 'Cash withdrawal', sub: 'Bank → cash in hand' },
  { value: 'transfer', label: 'Transfer between my accounts', sub: 'From one bank account to another' },
  { value: 'credit', label: 'Amount received (transfer in)', sub: 'Bank balance increases' },
  { value: 'debit', label: 'Payment / cheque issued', sub: 'Bank balance decreases' },
  { value: 'charges', label: 'Bank charges / tax', sub: 'Bank balance decreases' },
];

/** Values to start the form with, e.g. "deposit Dispenser 2's pending cash". Change `nonce` to apply again. */
export interface TxnPrefill {
  nonce: number;
  type?: BankTxnType;
  unitId?: string;
  bankId?: string;
  amount?: number;
}

type L = ReturnType<typeof useLookups>;

/** One-line title for a bank entry, e.g. "Cash deposit · Dispenser 2 (cross) · Slip 88". */
export function txnTitle(x: BankTxn, L: L): string {
  if (x.type === 'transfer') return `Transfer → ${L.bankName(x.toBankId)}${x.ref ? ' · ' + x.ref : ''}`;
  const label = TXN_TYPES.find((t) => t.value === x.type)?.label ?? x.type;
  const unit = x.type === 'deposit' && x.unitId ? L.unit.get(x.unitId) : undefined;
  const cross = unit?.bankId && unit.bankId !== x.bankId ? ' (cross)' : '';
  return `${label}${unit ? ` · ${unit.name}${cross}` : ''}${x.ref ? ' · ' + x.ref : ''}`;
}

export function txnSign(x: BankTxn): '+' | '−' | '⇄' {
  return x.type === 'transfer' ? '⇄' : x.type === 'deposit' || x.type === 'credit' ? '+' : '−';
}

export function BankTxnForm({
  date: fixedDate,
  prefill,
  defaultBankId,
  submitLabel = 'Add transaction',
  onAdd,
}: {
  /** Fixed date (Daily screen). Without it the form shows a date field. */
  date?: string;
  prefill?: TxnPrefill;
  defaultBankId?: string;
  submitLabel?: string;
  /** Return false to keep the form filled (e.g. the day is locked). */
  onAdd: (date: string, txn: BankTxn) => boolean | void;
}) {
  const { data } = useStore();
  const L = useLookups();
  const firstBank = defaultBankId ?? data.banks.find((b) => b.active)?.id;
  const blank = {
    date: fixedDate ?? todayStr(),
    type: 'deposit' as BankTxnType,
    unitId: undefined as string | undefined,
    bankId: firstBank,
    toBankId: undefined as string | undefined,
    amount: 0,
    ref: '',
    note: '',
  };
  const [f, setF] = useState(blank);

  useEffect(() => {
    if (!prefill) return;
    const unit = prefill.unitId ? L.unit.get(prefill.unitId) : undefined;
    setF((cur) => ({
      ...cur,
      type: prefill.type ?? cur.type,
      unitId: prefill.unitId,
      bankId: prefill.bankId ?? unit?.bankId ?? cur.bankId,
      amount: prefill.amount ?? cur.amount,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  useEffect(() => {
    if (defaultBankId) setF((cur) => ({ ...cur, bankId: defaultBankId }));
  }, [defaultBankId]);

  const unit = f.type === 'deposit' && f.unitId ? L.unit.get(f.unitId) : undefined;
  const cross = !!unit?.bankId && !!f.bankId && unit.bankId !== f.bankId;

  const submit = () => {
    const date = fixedDate ?? f.date;
    if (!isValidDate(date)) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD');
    if (!f.bankId || !f.amount) return Alert.alert('Missing', 'Select bank and enter amount.');
    if (f.type === 'transfer' && (!f.toBankId || f.toBankId === f.bankId)) return Alert.alert('Missing', 'Choose a different account to transfer to.');
    const txn: BankTxn = {
      id: uid(),
      bankId: f.bankId,
      type: f.type,
      amount: f.amount,
      ref: f.ref,
      note: f.note,
      ...(f.type === 'deposit' && f.unitId ? { unitId: f.unitId } : {}),
      ...(f.type === 'transfer' ? { toBankId: f.toBankId } : {}),
    };
    if (onAdd(date, txn) === false) return;
    setF({ ...blank, date, type: f.type, bankId: f.bankId, unitId: f.unitId, toBankId: f.toBankId });
  };

  return (
    <>
      {fixedDate ? null : <Field label="Date (YYYY-MM-DD)" value={f.date} onChange={(t) => setF({ ...f, date: t })} />}
      <Select label="Type" value={f.type} options={TXN_TYPES} onChange={(v) => setF({ ...f, type: (v as BankTxnType) || 'deposit' })} />
      {f.type === 'deposit' && data.units.length ? (
        <Select
          label="Cash of dispenser"
          value={f.unitId}
          options={L.opt.units.map((o) => ({ ...o, sub: `Bank: ${L.unit.get(o.value)?.bankId ? L.bankName(L.unit.get(o.value)?.bankId) : 'not set'}` }))}
          allowNone="— Not specified —"
          onChange={(v) => {
            const u = v ? L.unit.get(v) : undefined;
            setF({ ...f, unitId: v, bankId: u?.bankId ?? f.bankId });
          }}
        />
      ) : null}
      <Select label={f.type === 'transfer' ? 'From bank account' : 'Bank account'} value={f.bankId} options={L.opt.banks} onChange={(v) => setF({ ...f, bankId: v })} />
      {f.type === 'transfer' ? (
        <Select label="To bank account" value={f.toBankId} options={L.opt.banks.filter((o) => o.value !== f.bankId)} onChange={(v) => setF({ ...f, toBankId: v })} />
      ) : null}
      {cross ? (
        <Text style={{ color: C.accent, marginTop: 6 }}>
          ⇄ Cross deposit: {unit?.name}'s cash into {L.bankName(f.bankId)} (its own bank is {L.bankName(unit?.bankId)}).
        </Text>
      ) : null}
      <HStack>
        <NumInput label="Amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0 })} />
        <Field label="Slip / cheque / ref #" value={f.ref} onChange={(t) => setF({ ...f, ref: t })} />
      </HStack>
      <Field label="Note" value={f.note} onChange={(t) => setF({ ...f, note: t })} />
      <Btn title={submitLabel} onPress={submit} style={{ marginTop: 10 }} />
    </>
  );
}
