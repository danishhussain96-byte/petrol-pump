import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, View } from 'react-native';
import { bankBalance } from '../calc';
import { useLookups } from '../hooks';
import { PdfReader, type PdfResult } from '../PdfReader';
import { parsePdfItems, reconcile, summarize, type ParseResult, type StatementLine } from '../statement';
import { kindOf, parseCsvText, parseSpreadsheet } from '../statementFile';
import { useStore } from '../store';
import type { BankTxnType, SavedStatement } from '../types';
import { Btn, C, Card, Chip, Divider, Empty, Field, HStack, ListItem, Muted, Row, Screen, Select, Stat, confirm, diffColor } from '../ui';
import { num, prettyDate, uid } from '../utils';

type Stage =
  | { kind: 'list' }
  | { kind: 'reading'; name: string; base64: string; password?: string; attempt: number }
  | { kind: 'password'; name: string; base64: string; wrong: boolean }
  | { kind: 'review'; name: string; result: ParseResult }
  | { kind: 'view'; id: string };

const CREDIT_TYPES: { value: BankTxnType; label: string; sub: string }[] = [
  { value: 'deposit', label: 'Cash deposit', sub: "From the station's cash in hand" },
  { value: 'credit', label: 'Amount received', sub: 'Transfer / online / cheque received — no cash effect' },
];
const DEBIT_TYPES: { value: BankTxnType; label: string; sub: string }[] = [
  { value: 'withdrawal', label: 'Cash withdrawal', sub: 'Into cash in hand' },
  { value: 'debit', label: 'Payment / cheque', sub: 'No cash effect' },
  { value: 'charges', label: 'Bank charges / tax', sub: 'No cash effect' },
];

async function toBase64(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    const buf = new Uint8Array(await (asset.file as Blob).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  return new File(asset.uri).base64();
}

async function toText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') return (asset.file as Blob).text();
  return new File(asset.uri).text();
}

export function BankImport({ bankId: initialBank }: { bankId?: string }) {
  const { data, update } = useStore();
  const L = useLookups();
  const [stage, setStage] = useState<Stage>({ kind: 'list' });
  const [bankId, setBankId] = useState<string | undefined>(initialBank ?? data.banks[0]?.id);
  const [password, setPassword] = useState('');

  const gotResult = useCallback((name: string, result: ParseResult) => {
    if (result.lines.length === 0) {
      Alert.alert(
        'No transactions found',
        'Could not find dated transactions with amounts in this file. Try the Excel / CSV download from your internet banking, or a PDF that is not a scanned picture.',
      );
      setStage({ kind: 'list' });
      return;
    }
    setStage({ kind: 'review', name, result });
  }, []);

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const kind = kindOf(asset.name, asset.mimeType ?? undefined);
      if (!kind) {
        Alert.alert(
          'File type not supported',
          'Upload the statement as PDF, Excel (.xlsx / .xls) or CSV. Photos of a printed statement cannot be read — download the e-statement from your bank app or internet banking.',
        );
        return;
      }
      if (kind === 'pdf') {
        setPassword('');
        setStage({ kind: 'reading', name: asset.name, base64: await toBase64(asset), attempt: 1 });
      } else if (kind === 'sheet') gotResult(asset.name, parseSpreadsheet(await toBase64(asset)));
      else gotResult(asset.name, parseCsvText(await toText(asset)));
    } catch (e) {
      Alert.alert('Could not read the file', String(e));
      setStage({ kind: 'list' });
    }
  };

  const onPdf = (s: Extract<Stage, { kind: 'reading' }>) => (r: PdfResult) => {
    if (r.items) gotResult(s.name, parsePdfItems(r.items));
    else if (r.error === 'password' || r.error === 'badpassword') setStage({ kind: 'password', name: s.name, base64: s.base64, wrong: r.error === 'badpassword' });
    else {
      Alert.alert('Could not read this PDF', r.error === 'unsupported' ? r.message ?? '' : `${r.message ?? ''}\n\nIf it is a scanned picture, download the e-statement (PDF or Excel) from your bank instead.`);
      setStage({ kind: 'list' });
    }
  };

  const save = (name: string, result: ParseResult) => {
    if (!bankId) return Alert.alert('Select bank account', 'Choose which bank account this statement belongs to.');
    const st: SavedStatement = {
      id: uid(),
      bankId,
      fileName: name,
      importedAt: new Date().toISOString(),
      lines: result.lines,
      openingBalance: result.openingBalance,
      warnings: result.warnings,
    };
    update((d) => ({ ...d, statements: [...d.statements, st] }));
    setStage({ kind: 'view', id: st.id });
  };

  if (data.banks.length === 0) return <Screen><Empty text="Add a bank account in Setup → Bank accounts first." /></Screen>;

  // ---- Reading a PDF
  if (stage.kind === 'reading') {
    return (
      <Screen>
        <Card title="Reading statement…">
          <ActivityIndicator color={C.primary} size="large" style={{ marginVertical: 16 }} />
          <Muted style={{ textAlign: 'center' }}>{stage.name}</Muted>
        </Card>
        <PdfReader key={stage.attempt} base64={stage.base64} password={stage.password} onDone={onPdf(stage)} />
        <Btn title="Cancel" kind="secondary" onPress={() => setStage({ kind: 'list' })} />
      </Screen>
    );
  }

  // ---- Locked PDF
  if (stage.kind === 'password') {
    return (
      <Screen>
        <Card title="🔒 This PDF is password protected">
          <Muted>
            Bank e-statements are often locked, for example with your CNIC digits, date of birth or account number. Enter the password your bank gave you.
          </Muted>
          <Field label="PDF password" value={password} onChange={setPassword} secure />
          {stage.wrong ? <Text style={{ color: C.red, marginTop: 6 }}>Wrong password, try again.</Text> : null}
          <HStack style={{ marginTop: 12 }}>
            <Btn title="Cancel" kind="secondary" onPress={() => setStage({ kind: 'list' })} />
            <Btn
              title="Open"
              style={{ flex: 1 }}
              onPress={() => setStage({ kind: 'reading', name: stage.name, base64: stage.base64, password, attempt: Date.now() })}
            />
          </HStack>
        </Card>
      </Screen>
    );
  }

  // ---- Review before saving
  if (stage.kind === 'review') {
    const s = summarize(stage.result.lines, stage.result.openingBalance);
    return (
      <Screen>
        <Card title="Statement read">
          <Muted>{stage.name}</Muted>
          <Select label="This statement is for bank account" value={bankId} options={L.opt.banks} onChange={setBankId} />
          <Row label="Period" value={`${s.from} to ${s.to}`} />
          <Row label="Transactions" value={String(s.count)} />
          <Row label={`Deposits (${s.depositCount})`} value={`${L.cur} ${num(s.totalCredit)}`} color={C.green} bold />
          <Row label={`Withdrawals (${s.count - s.depositCount})`} value={`${L.cur} ${num(s.totalDebit)}`} color={C.red} />
          {s.openingBalance !== undefined ? <Row label="Opening balance" value={num(s.openingBalance)} /> : null}
          {s.closingBalance !== undefined ? <Row label="Closing balance" value={num(s.closingBalance)} /> : null}
          {stage.result.warnings.map((w, i) => (
            <Text key={i} style={{ color: C.accent, marginTop: 6 }}>
              ⚠ {w}
            </Text>
          ))}
        </Card>
        <Card title="First lines — check they look right">
          {stage.result.lines.slice(0, 8).map((l, i) => (
            <LineRow key={i} line={l} />
          ))}
          {stage.result.lines.length > 8 ? <Muted>…and {stage.result.lines.length - 8} more</Muted> : null}
        </Card>
        <HStack>
          <Btn title="Cancel" kind="secondary" onPress={() => setStage({ kind: 'list' })} />
          <Btn title="Save & compare with app" style={{ flex: 1 }} onPress={() => save(stage.name, stage.result)} />
        </HStack>
      </Screen>
    );
  }

  // ---- One saved statement
  if (stage.kind === 'view') {
    const st = data.statements.find((x) => x.id === stage.id);
    if (!st) return <Screen><Btn title="‹ Back" kind="ghost" onPress={() => setStage({ kind: 'list' })} /></Screen>;
    return <StatementDetail st={st} onBack={() => setStage({ kind: 'list' })} />;
  }

  // ---- List
  const saved = data.statements.filter((s) => !bankId || s.bankId === bankId).slice().reverse();
  return (
    <Screen>
      <Card title="📄 Upload bank statement">
        <Muted>
          Choose the statement file from your bank (PDF, Excel or CSV). The app reads every line, totals the deposits and withdrawals, and shows which ones are missing from your entries.
        </Muted>
        <Select label="Bank account" value={bankId} options={L.opt.banks} onChange={setBankId} />
        <Btn title="Choose statement file" onPress={pick} style={{ marginTop: 10 }} />
      </Card>
      <Card title="Uploaded statements">
        {saved.length === 0 ? <Empty text="None yet" /> : null}
        {saved.map((s) => {
          const sm = summarize(s.lines);
          return (
            <ListItem
              key={s.id}
              title={`${L.bankName(s.bankId)} · ${sm.from} to ${sm.to}`}
              sub={`${s.fileName} · deposits ${L.cur} ${num(sm.totalCredit)}`}
              onPress={() => setStage({ kind: 'view', id: s.id })}
            />
          );
        })}
      </Card>
      <Muted>To type a deposit yourself, use the Bank statement tab → "Add bank entry", or Daily → Bank.</Muted>
    </Screen>
  );
}

function LineRow({ line, status, onAdd }: { line: StatementLine; status?: 'matched' | 'missing'; onAdd?: () => void }) {
  return (
    <View style={{ paddingVertical: 7, borderBottomWidth: 1, borderColor: '#EEF2F6' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ flex: 1, color: C.text }} numberOfLines={2}>
          {line.description || '—'}
        </Text>
        <Text style={{ color: line.credit ? C.green : C.red, fontWeight: '700' }}>{line.credit ? `+${num(line.credit)}` : `−${num(line.debit)}`}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        <Muted>
          {line.date}
          {line.balance !== undefined ? ` · Bal ${num(line.balance)}` : ''}
        </Muted>
        {status === 'matched' ? <Text style={{ color: C.green, fontSize: 13 }}>✓ in app</Text> : null}
        {status === 'missing' ? (
          <HStack style={{ alignItems: 'center' }}>
            <Text style={{ color: C.accent, fontSize: 13 }}>Not in app</Text>
            {onAdd ? <Btn title="+ Add" small kind="secondary" onPress={onAdd} /> : null}
          </HStack>
        ) : null}
      </View>
    </View>
  );
}

type Filter = 'all' | 'missing' | 'matched' | 'deposits';

function StatementDetail({ st, onBack }: { st: SavedStatement; onBack: () => void }) {
  const { data, ledger, update, updateDay } = useStore();
  const L = useLookups();
  const [filter, setFilter] = useState<Filter>('missing');
  const [adding, setAdding] = useState<{ index: number; type: BankTxnType } | null>(null);
  const s = useMemo(() => summarize(st.lines, st.openingBalance), [st]);
  const rec = useMemo(() => reconcile(ledger, st.bankId, st.lines), [ledger, st]);
  const appBalance = s.to ? bankBalance(data, ledger, st.bankId, s.to) : 0;
  const missingCredits = st.lines.map((l, i) => ({ l, i })).filter(({ l, i }) => rec.match[i] < 0 && l.credit > 0);

  const addLine = (line: StatementLine, type: BankTxnType) => {
    if (data.days[line.date]?.locked) {
      Alert.alert('Day is locked', `Unlock ${prettyDate(line.date)} in Daily → Summary first.`);
      return;
    }
    updateDay(line.date, (d) => ({
      ...d,
      bankTxns: [
        ...d.bankTxns,
        { id: uid(), bankId: st.bankId, type, amount: line.credit || line.debit, ref: 'Statement', note: line.description.slice(0, 80) },
      ],
    }));
  };

  const shown = st.lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) =>
      filter === 'all' ? true : filter === 'missing' ? rec.match[i] < 0 : filter === 'matched' ? rec.match[i] >= 0 : l.credit > 0,
    );

  return (
    <Screen>
      <Btn title="‹ All statements" kind="ghost" onPress={onBack} style={{ alignSelf: 'flex-start' }} />
      <Card title={`${L.bankName(st.bankId)} · ${s.from} to ${s.to}`}>
        <Muted>{st.fileName}</Muted>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Stat label={`Deposited (${s.depositCount})`} value={`${L.cur} ${num(s.totalCredit)}`} color={C.green} />
        <Stat label={`Withdrawn (${s.count - s.depositCount})`} value={`${L.cur} ${num(s.totalDebit)}`} color={C.red} />
        <Stat label="Matched with app" value={`${rec.matchedCount} / ${s.count}`} color={rec.matchedCount === s.count ? C.green : C.accent} />
        <Stat label="App entries not on statement" value={String(rec.unmatchedApp.length)} color={rec.unmatchedApp.length ? C.accent : C.green} />
      </View>
      {st.warnings.map((w, i) => (
        <Text key={i} style={{ color: C.accent, marginBottom: 6 }}>
          ⚠ {w}
        </Text>
      ))}
      <Card title="Balance check">
        {s.closingBalance !== undefined ? <Row label={`Bank closing balance (${s.to})`} value={num(s.closingBalance)} /> : <Muted>The statement has no balance column.</Muted>}
        <Row label={`App balance (${s.to})`} value={num(appBalance)} />
        {s.closingBalance !== undefined ? (
          <Row
            label="Difference"
            value={Math.abs(s.closingBalance - appBalance) < 0.5 ? 'Matched ✓' : num(s.closingBalance - appBalance)}
            color={diffColor(Math.abs(s.closingBalance - appBalance) < 0.5 ? 0 : -1)}
            bold
          />
        ) : null}
      </Card>
      <Card title="Day-wise deposits">
        <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
          <Text style={{ flex: 1.2, color: C.muted, fontSize: 12 }}>Date</Text>
          <Text style={{ flex: 1, color: C.muted, fontSize: 12, textAlign: 'right' }}>Bank</Text>
          <Text style={{ flex: 1, color: C.muted, fontSize: 12, textAlign: 'right' }}>App</Text>
          <Text style={{ flex: 1, color: C.muted, fontSize: 12, textAlign: 'right' }}>Diff</Text>
        </View>
        {rec.byDate
          .filter((r) => r.statementCredit || r.appCredit)
          .map((r) => {
            const diff = r.statementCredit - r.appCredit;
            return (
              <View key={r.date} style={{ flexDirection: 'row', paddingVertical: 4, borderTopWidth: 1, borderColor: '#EEF2F6' }}>
                <Text style={{ flex: 1.2, color: C.text, fontSize: 13 }}>{r.date.slice(5)}</Text>
                <Text style={{ flex: 1, color: C.text, fontSize: 13, textAlign: 'right' }}>{num(r.statementCredit)}</Text>
                <Text style={{ flex: 1, color: C.text, fontSize: 13, textAlign: 'right' }}>{num(r.appCredit)}</Text>
                <Text style={{ flex: 1, fontSize: 13, textAlign: 'right', color: Math.abs(diff) < 0.5 ? C.green : C.red }}>{Math.abs(diff) < 0.5 ? '✓' : num(diff)}</Text>
              </View>
            );
          })}
        <Divider />
        <Row label="Total deposits" value={`${num(s.totalCredit)} bank · ${num(rec.byDate.reduce((a, r) => a + r.appCredit, 0))} app`} bold />
      </Card>
      <Card title="Statement lines">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          <Chip title={`Not in app (${s.count - rec.matchedCount})`} active={filter === 'missing'} onPress={() => setFilter('missing')} />
          <Chip title="Deposits" active={filter === 'deposits'} onPress={() => setFilter('deposits')} />
          <Chip title="Matched" active={filter === 'matched'} onPress={() => setFilter('matched')} />
          <Chip title="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        </View>
        {filter === 'missing' && missingCredits.length > 1 ? (
          <Btn
            title={`Add all ${missingCredits.length} missing deposits as cash deposits`}
            kind="secondary"
            small
            style={{ marginBottom: 6 }}
            onPress={() =>
              confirm(
                `Add ${missingCredits.length} deposits (${L.cur} ${num(missingCredits.reduce((a, x) => a + x.l.credit, 0))}) as cash deposited from the station? This lowers cash in hand on those days. Card / online settlements should be added one by one as "Amount received" instead.`,
                () => missingCredits.forEach(({ l }) => addLine(l, 'deposit')),
                'Add all',
              )
            }
          />
        ) : null}
        {shown.length === 0 ? <Empty text={filter === 'missing' ? 'Everything on the statement is in the app ✓' : 'Nothing to show'} /> : null}
        {shown.map(({ l, i }) => (
          <View key={i}>
            <LineRow
              line={l}
              status={rec.match[i] >= 0 ? 'matched' : 'missing'}
              onAdd={() => setAdding({ index: i, type: l.credit ? 'deposit' : 'debit' })}
            />
            {adding?.index === i ? (
              <View style={{ backgroundColor: C.chip, padding: 8, borderRadius: 8, marginBottom: 6 }}>
                <Select
                  label={`Add to ${prettyDate(l.date)} as`}
                  value={adding.type}
                  options={l.credit ? CREDIT_TYPES : DEBIT_TYPES}
                  onChange={(v) => setAdding({ index: i, type: (v as BankTxnType) || adding.type })}
                />
                <HStack style={{ marginTop: 8 }}>
                  <Btn title="Cancel" kind="ghost" small onPress={() => setAdding(null)} />
                  <Btn
                    title="Add to app"
                    small
                    style={{ flex: 1 }}
                    onPress={() => {
                      addLine(l, adding.type);
                      setAdding(null);
                    }}
                  />
                </HStack>
              </View>
            ) : null}
          </View>
        ))}
      </Card>
      {rec.unmatchedApp.length ? (
        <Card title="In the app but not on the statement">
          <Muted style={{ marginBottom: 4 }}>Check these: wrong amount or date, not yet cleared, or entered in the wrong bank.</Muted>
          {rec.unmatchedApp.map((mi) => {
            const m = rec.appMoves[mi];
            return <ListItem key={mi} title={m.description} sub={m.date} right={m.credit ? `+${num(m.credit)}` : `−${num(m.debit)}`} />;
          })}
        </Card>
      ) : null}
      <Btn
        title="Delete this uploaded statement"
        kind="ghost"
        onPress={() =>
          confirm('Remove this uploaded statement? Entries already added to the app stay.', () => {
            update((d) => ({ ...d, statements: d.statements.filter((x) => x.id !== st.id) }));
            onBack();
          })
        }
      />
    </Screen>
  );
}
