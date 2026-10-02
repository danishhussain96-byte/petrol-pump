import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { bankStatement } from '../calc';
import { useLookups } from '../hooks';
import { shareHtml, statementHtml } from '../report';
import { useStore } from '../store';
import { Btn, C, Card, ChipBar, Divider, Empty, Field, HStack, ListItem, Muted, NumInput, Row, Screen, Select, confirm, diffColor } from '../ui';
import { isValidDate, monthStart, num, prettyDate, round2, todayStr } from '../utils';
import { BankImport } from './BankImport';
import { BankTxnForm, txnTitle } from './BankTxnForm';

type Tab = 'bank' | 'upload';

export function Ledgers() {
  const [tab, setTab] = useState<Tab>('bank');
  return (
    <View style={{ flex: 1 }}>
      <ChipBar
        items={[
          { key: 'bank', label: '🏦 Bank statement' },
          { key: 'upload', label: '📄 Upload statement' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'bank' ? <BankStatementView /> : <BankImport />}
    </View>
  );
}

/** Where to change bank lines that the app creates from other entries. */
const WHERE: Record<string, string> = {
  card: 'POS (card) sales. Change them on Daily → the dispenser → Money received.',
  digital: 'Online / UPI sales. Change them on Daily → the dispenser → Money received.',
  receipt: 'A payment from a credit customer or a cleared cheque. Change it in the Credit tab, or Daily → Station → Credit & recovery.',
  expense: 'An expense paid from bank. Change it on Daily → Station → Expenses.',
  purchase: 'Stock bought and paid from bank. Change it on Daily → Station → Stock & Dip.',
};

function BankStatementView() {
  const { data, ledger, updateDay } = useStore();
  const deleteTxn = (date: string, txnId: string, description: string) => {
    if (data.days[date]?.locked) return Alert.alert('Day is locked', `Unlock ${prettyDate(date)} in Daily → Station → Summary first.`);
    confirm(`Delete "${description}" on ${prettyDate(date)}?`, () =>
      updateDay(date, (d) => ({ ...d, bankTxns: d.bankTxns.filter((x) => x.id !== txnId) })),
    );
  };
  const L = useLookups();
  const today = todayStr();
  const [bankId, setBankId] = useState<string | undefined>(data.banks[0]?.id);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [actual, setActual] = useState<number | undefined>(undefined);
  const valid = !!bankId && isValidDate(from) && isValidDate(to) && from <= to;
  const st = useMemo(() => (valid && bankId ? bankStatement(data, ledger, bankId, from, to) : null), [data, ledger, bankId, from, to, valid]);
  if (data.banks.length === 0) return <Screen><Empty text="Add a bank account in Setup → Bank accounts." /></Screen>;
  const recon = actual !== undefined && st ? round2(actual - st.closing) : undefined;
  return (
    <Screen>
      <Select label="Bank account" value={bankId} options={L.opt.banks.length ? L.opt.banks : data.banks.map((b) => ({ value: b.id, label: b.name }))} onChange={setBankId} />
      <HStack style={{ marginBottom: 12 }}>
        <Field label="From" value={from} onChange={setFrom} />
        <Field label="To" value={to} onChange={setTo} />
      </HStack>
      {!st ? <Empty text="Enter a valid date range" /> : null}
      {st ? (
        <>
          <Card title="Statement">
            <Row label="Opening balance" value={`${L.cur} ${num(st.opening)}`} bold />
            <Divider />
            {st.rows.length === 0 ? <Empty text="No transactions in this period" /> : null}
            {st.rows.map((r, i) => (
              <Pressable
                key={i}
                onPress={() => !r.txnId && Alert.alert('Entered elsewhere', WHERE[r.kind] ?? 'This entry comes from another screen.')}
                style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: '#EEF2F6' }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: C.text }}>{r.description}</Text>
                  <Text style={{ color: r.credit ? C.green : C.red, fontWeight: '600' }}>{r.credit ? `+${num(r.credit)}` : `−${num(r.debit)}`}</Text>
                  {r.txnId ? (
                    <Pressable hitSlop={10} onPress={() => deleteTxn(r.date, r.txnId!, r.description)}>
                      <Text style={{ color: C.red, fontSize: 18, paddingLeft: 6 }}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Muted>{r.date}</Muted>
                  <Muted>Bal {num(r.balance)}</Muted>
                </View>
              </Pressable>
            ))}
            {st.rows.length ? <Muted style={{ marginTop: 6 }}>Tap ✕ to delete an entry you typed. Other lines come from Daily / Credit screens.</Muted> : null}
            <Divider />
            <Row label="Total credits (in)" value={num(st.totalCredit)} color={C.green} />
            <Row label="Total debits (out)" value={num(st.totalDebit)} color={C.red} />
            <Row label="Closing balance" value={`${L.cur} ${num(st.closing)}`} bold />
          </Card>
          <ManualBankEntry bankId={bankId} />
          <Card title="Reconcile with bank statement">
            <Muted>Enter the closing balance shown on your actual bank statement for {to}, or upload the statement file in the "Upload statement" tab.</Muted>
            <NumInput label="Balance as per bank" value={actual} allowEmpty onChange={setActual} />
            {recon !== undefined ? (
              <Row
                label="Difference"
                value={Math.abs(recon) < 0.005 ? 'Matched ✓' : `${num(recon)} (${recon > 0 ? 'bank has more — unrecorded receipts?' : 'bank has less — charges / uncleared?'})`}
                color={diffColor(recon)}
                bold
              />
            ) : null}
          </Card>
          <Btn title="📄 Share statement PDF" onPress={() => bankId && shareHtml(statementHtml(data, bankId, from, to, st), 'Bank statement').catch((e) => Alert.alert('Error', String(e)))} />
        </>
      ) : null}
    </Screen>
  );
}

/** Type a bank entry (e.g. a cash deposit) for any date, without opening that day. */
function ManualBankEntry({ bankId }: { bankId?: string }) {
  const { data, updateDay } = useStore();
  const L = useLookups();
  return (
    <Card title="✍️ Add bank entry">
      <BankTxnForm
        defaultBankId={bankId}
        submitLabel="Add entry"
        onAdd={(date, txn) => {
          if (data.days[date]?.locked) {
            Alert.alert('Day is locked', `Unlock ${prettyDate(date)} in Daily → Summary first.`);
            return false;
          }
          updateDay(date, (d) => ({ ...d, bankTxns: [...d.bankTxns, txn] }));
          Alert.alert('Added', `${txnTitle(txn, L)}: ${L.cur} ${num(txn.amount)} on ${prettyDate(date)}.`);
        }}
      />
    </Card>
  );
}
